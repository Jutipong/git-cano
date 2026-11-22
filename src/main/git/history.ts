import { assignLanes } from '@shared/lanes'

import { parseLog } from '../parsers'
import { getActiveRepoPath, getRepo, getRepoFor } from './repo'
import { pushUndo } from './undo'

import type { BlameLine, CommitDetails, CommitNode, ReflogEntry } from '@shared/types'

/** History slice: commit log, solo log, commit details/body, file history, blame and the reflog recovery net. */

/**
 * Last computed log per repo path - lets the renderer paint instantly (stale-while-revalidate) when switching back. Bounded to the most
 * recently used repos so a long session with many tabs can't grow it forever.
 */
const logCache = new Map<string, { limit: number; commits: CommitNode[] }>()
const LOG_CACHE_MAX_REPOS = 6

function logArgs(limit: number, skip?: number): string[] {
    return [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        '--decorate=full',
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%<(1,trunc)%b'].join('\x1f')}\x1e`,
        '--date=iso',
        `--max-count=${limit}`,
        ...(skip ? [`--skip=${skip}`] : []),
        '--',
    ]
}

/** Moves a repo's log entry to the MRU end of the bounded cache, evicting the oldest entry when full. */
function cacheLog(repoPath: string, limit: number, commits: CommitNode[]): void {
    logCache.delete(repoPath)
    logCache.set(repoPath, { limit, commits })
    while (logCache.size > LOG_CACHE_MAX_REPOS) {
        const oldest = logCache.keys().next().value
        if (oldest === undefined) break
        logCache.delete(oldest)
    }
}

export async function getLog(limit = 500): Promise<CommitNode[]> {
    const { path: p, git: g } = getRepo()
    const commits = parseLog(await g.raw(logArgs(limit)))
    assignLanes(commits)
    cacheLog(p, limit, commits)
    return commits
}

/** Commit body only (`%b`) — lazy-loaded for the graph's message popover so the full log stays lean. Null when empty. */
export async function getCommitBody(hash: string, dir?: string): Promise<string | null> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    try {
        const body = (await g.raw(['show', '-s', '--format=%b', hash])).trim()
        return body || null
    } catch {
        return null
    }
}

/** Returns the cached log for the active repo when it covers `limit`, else null. May be stale — the renderer re-validates with repo:log. */
export function getCachedLog(limit = 500): CommitNode[] | null {
    const active = getActiveRepoPath()
    if (!active) return null
    const entry = logCache.get(active)
    if (!entry || entry.limit < limit) return null
    // Reading counts as use — keep this repo at the MRU end of the bounded cache.
    logCache.delete(active)
    logCache.set(active, entry)
    return entry.commits.slice(0, limit)
}

export async function getLogPage(offset: number, limit: number): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    return parseLog(await g.raw(logArgs(limit, Math.max(0, offset))))
}

function soloLogArgs(branch: string, limit: number, skip?: number): string[] {
    return [
        'log',
        branch,
        '--decorate=full',
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%<(1,trunc)%b'].join('\x1f')}\x1e`,
        '--date=iso',
        `--max-count=${limit}`,
        ...(skip ? [`--skip=${skip}`] : []),
        '--',
    ]
}

function requireRevision(rev: string): string {
    const trimmed = rev.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) throw new Error('A branch is required')
    return trimmed
}

/** Commits reachable from a single branch — powers branch Solo in the graph. */
export async function getSoloLog(branch: string, limit = 500): Promise<CommitNode[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const commits = parseLog(await g.raw(soloLogArgs(rev, limit)))
    assignLanes(commits)
    return commits
}

export async function getSoloLogPage(branch: string, offset: number, limit: number): Promise<CommitNode[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const commits = parseLog(await g.raw(soloLogArgs(rev, limit, Math.max(0, offset))))
    assignLanes(commits)
    return commits
}

/**
 * Files touched by the commits visible in branch Solo (same depth as the solo log) — powers Focus dimming in FilePanel. One spawn, paths
 * only.
 */
export async function listSoloFiles(branch: string, limit = 500): Promise<string[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const text = await g.raw(['log', '--pretty=format:', '--name-only', `--max-count=${limit}`, rev, '--'])
    return [
        ...new Set(
            text
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
        ),
    ]
}

export async function getCommitDetails(hash: string): Promise<CommitDetails> {
    const { git: g } = getRepo()
    const [metadata, message] = await Promise.all([
        g.raw(['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P', hash]),
        g.raw(['show', '-s', '--format=%B', hash]),
    ])
    const [fullHash, author, email, date, parents = ''] = metadata.trim().split('\u001f')
    const parent = parents.split(' ').filter(Boolean)[0]
    // Deliberately no full `git diff` here: the Changes panel only needs the file list + message, and the
    // per-file diff is fetched lazily by DiffView through `file:commitDiff`. Diffing here doubled peak
    // memory (text + parsed lines on both sides of the IPC) for a payload the renderer discarded.
    const [fileText, numstatText] = await Promise.all([
        parent
            ? g.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', parent, hash])
            : g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
        parent
            ? g.raw(['diff-tree', '--no-commit-id', '--numstat', '-r', parent, hash])
            : g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
    ])

    const statMap = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstatText.split('\n')) {
        if (!line.trim()) continue
        const [add, del, ...pathParts] = line.split('\t')
        statMap.set(pathParts.join('\t'), {
            additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
            deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
        })
    }

    const files = fileText
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [status, ...pathParts] = line.split('\t')
            const path = pathParts.join('\t')
            return { path, status, ...(statMap.get(path) ?? { additions: 0, deletions: 0 }) }
        })
    return {
        hash: fullHash || hash,
        message: message.trim(),
        author,
        email,
        date,
        parents: parents.split(' ').filter(Boolean),
        files,
    }
}

/**
 * HEAD reflog, newest first. This is the recovery net for history that the undo toast window has already closed over (e.g. a hard reset) —
 * the objects are still on disk.
 */
export async function listReflog(limit = 100): Promise<ReflogEntry[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const capped = Math.max(1, Math.min(500, Math.floor(limit) || 100))
    // `--date=iso-strict` makes %gd render HEAD@{<ISO 8601>}; the index is rebuilt from row order.
    // An unborn branch has no reflog at all — git exits non-zero with a raw fatal message, which
    // this recovery tool should surface as "nothing to recover", not as an error.
    const text = await g.raw(['reflog', '--date=iso-strict', `--format=%H${SEP}%h${SEP}%gd${SEP}%gs`, '-n', String(capped)]).catch(() => '')
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const [hash, shortHash, selectorRaw, subject = ''] = line.split(SEP)
            const selector = (selectorRaw ?? '').trim()
            const date = /^HEAD@\{(.+)\}$/.exec(selector)?.[1]?.trim() ?? ''
            const colonAt = subject.indexOf(':')
            return {
                index,
                hash: hash ?? '',
                shortHash: shortHash ?? '',
                selector: `HEAD@{${index}}`,
                action: colonAt >= 0 ? subject.slice(0, colonAt).trim() : subject.trim(),
                message: colonAt >= 0 ? subject.slice(colonAt + 1).trim() : '',
                date,
            }
        })
}

/** Moves the current branch back to a reflog entry. Always journaled — the restore itself is undoable. */
export async function restoreReflog(ref: string): Promise<string> {
    const { path: p, git: g } = getRepo()
    const target = ref.trim()
    if (!target) throw new Error('A reflog entry is required')
    await g.raw(['rev-parse', '--verify', `${target}^{commit}`])
    if ((await g.status()).files.length > 0) throw new Error('Commit or stash your changes first')
    const headBefore = (await g.revparse(['HEAD'])).trim()
    await g.raw(['reset', '--hard', target])
    pushUndo({ label: 'reflog restore', doneMessage: 'Reflog restore undone', repoPath: p, kind: 'reset', headBefore, resetMode: 'hard' })
    return (await g.revparse(['HEAD'])).trim()
}

export async function getFileHistory(file: string, limit = 200): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
    const text = await g.raw(['log', '--follow', `--pretty=format:${fmt}${REC}`, `--max-count=${limit}`, '--', file])
    return text
        .split(REC)
        .map(line => line.replace(/^\n/, ''))
        .filter(line => line.trim())
        .map(line => {
            const [hash, shortHash, author, date, subject] = line.split(SEP)
            return { hash, shortHash, parents: [], author, date, subject, refs: [], lane: 0 }
        })
}

export async function getBlame(file: string, rev?: string): Promise<BlameLine[]> {
    const { git: g } = getRepo()
    const at = rev?.trim()
    const text = await g.raw(at ? ['blame', '--line-porcelain', at, '--', file] : ['blame', '--line-porcelain', '--', file])
    const result: BlameLine[] = []
    const current: Partial<BlameLine> = {}
    for (const line of text.split('\n')) {
        if (line.startsWith('\t')) {
            result.push({
                hash: current.hash ?? '',
                author: current.author ?? '',
                date: current.date ?? '',
                lineNumber: current.lineNumber ?? 0,
                content: line.slice(1),
                ...(current.summary ? { summary: current.summary } : {}),
            })
            continue
        }
        const spaceAt = line.indexOf(' ')
        const key = spaceAt === -1 ? line : line.slice(0, spaceAt)
        const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1)
        if (/^[0-9a-f]{40}$/.test(key)) {
            // A new commit block starts — reset the per-commit fields (summary repeats only on first sighting).
            // The header carries `<orig> <final> [<count>]`: `final` is the line number in the blamed file.
            current.hash = key
            current.summary = undefined
            const finalNo = parseInt(value.split(' ')[1], 10)
            if (Number.isFinite(finalNo)) current.lineNumber = finalNo
        } else if (key === 'author') current.author = value
        else if (key === 'author-time') current.date = new Date(parseInt(value, 10) * 1000).toISOString()
        else if (key === 'summary' && current.summary === undefined) current.summary = value
        else if (/^\d+$/.test(key)) current.lineNumber = parseInt(key, 10)
    }
    return result
}
