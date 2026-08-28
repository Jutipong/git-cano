import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FSWatcher } from 'node:fs'

import { simpleGit, type SimpleGit } from 'simple-git'

import { log, maskUrl } from './logger'

import type {
    BlameLine,
    BranchInfo,
    CommitDetails,
    CommitNode,
    DiffLine,
    FileEntry,
    RebaseEntry,
    RebaseOutcome,
    RemoteTestResult,
    RepoState,
    RepoStatus,
    StashEntry,
    WorktreeInfo,
} from '@shared/types'

/* Multi-repo support: one SimpleGit instance per opened repo, one active at a time */
const repoInstances = new Map<string, SimpleGit>()
let activeRepoPath: string | null = null

/** SimpleGit instance with a debug hook that records every raw git command. */
function createGit(dir: string): SimpleGit {
    return simpleGit(dir, {
        debug: (data: string) => log('debug', 'git', maskUrl(data)),
    })
}

export function getRepo(): { path: string; git: SimpleGit } {
    if (!activeRepoPath) throw new Error('No repository opened')
    const instance = repoInstances.get(activeRepoPath)
    if (!instance) throw new Error('Active repository is not registered')
    return { path: activeRepoPath, git: instance }
}

export async function openRepo(dir: string): Promise<RepoStatus> {
    const g = repoInstances.get(dir) ?? createGit(dir)
    if (!(await g.checkIsRepo())) {
        throw new Error(`"${dir}" is not a git repository`)
    }
    const reopened = repoInstances.has(dir)
    repoInstances.set(dir, g)
    activeRepoPath = dir
    watchRepo(dir)
    log('info', 'repo', `${reopened ? 'reopen' : 'open'} ${dir}`)
    return getStatus()
}

export function setActiveRepo(dir: string): void {
    if (!repoInstances.has(dir)) throw new Error(`Repository "${dir}" is not open`)
    activeRepoPath = dir
    log('info', 'repo', `active -> ${dir}`)
}

export function listOpenRepos(): string[] {
    return [...repoInstances.keys()]
}

export function closeRepo(dir?: string): void {
    const target = dir ?? activeRepoPath
    if (!target) return
    repoInstances.delete(target)
    unwatchRepo(target)
    if (activeRepoPath === target) {
        activeRepoPath = repoInstances.keys().next().value ?? null
        log('info', 'repo', `close ${target} — active falls back to ${activeRepoPath ?? 'none'}`)
    } else {
        log('info', 'repo', `close ${target}`)
    }
}

/* ---- .git watcher: notify renderer when the repo changes externally ---- */
const repoWatchers = new Map<string, FSWatcher[]>()
let repoChangeCallback: ((repoPath: string) => void) | null = null
const emitTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onRepoChanged(callback: (repoPath: string) => void): void {
    repoChangeCallback = callback
}

function watchRepo(dir: string): void {
    if (repoWatchers.has(dir)) return
    const gitDir = path.join(dir, '.git')
    if (!fs.existsSync(gitDir)) return
    const watchers: FSWatcher[] = []
    const emit = () => emitRepoChanged(dir)
    try {
        // HEAD/config live at the top level of .git.
        // `index` is deliberately ignored: every `git status` run rewrites the
        // index stat-cache, which would fire the watcher and make the renderer
        // refresh again — an endless self-sustaining refresh loop.
        // `.lock` files are transient git-internal bookkeeping, same story.
        watchers.push(
            fs.watch(gitDir, (_event, filename) => {
                const name = typeof filename === 'string' ? filename : ''
                if (!name || name === 'index' || name.endsWith('.lock')) return
                emit()
            })
        )
        // branch refs update on commit/checkout — recursive works on macOS/Windows
        watchers.push(fs.watch(path.join(gitDir, 'refs'), { recursive: true } as never, emit))
    } catch {
        /* filesystem without fs.watch support — polling fallback still applies */
    }
    repoWatchers.set(dir, watchers)
}

function unwatchRepo(dir: string): void {
    for (const watcher of repoWatchers.get(dir) ?? []) {
        watcher.close()
    }
    repoWatchers.delete(dir)
    const timer = emitTimers.get(dir)
    if (timer) clearTimeout(timer)
    emitTimers.delete(dir)
}

function emitRepoChanged(dir: string): void {
    // git writes several files per operation — collapse into one notification
    const existing = emitTimers.get(dir)
    if (existing) clearTimeout(existing)
    emitTimers.set(
        dir,
        setTimeout(() => {
            emitTimers.delete(dir)
            repoChangeCallback?.(dir)
        }, 300)
    )
}

export function isOpen(): boolean {
    return activeRepoPath !== null
}

/* ---------------- Status ---------------- */

export async function getStatus(): Promise<RepoStatus> {
    const { path: p, git: g } = getRepo()
    const status = await g.status()
    const files: FileEntry[] = status.files.map(f => ({
        path: f.path,
        staged: f.index === '?' ? 'A' : f.index,
        unstaged: f.working_dir,
    }))
    // sort: staged first, then unstaged, then untracked — alphabetical within group
    const rank = (f: FileEntry) => (f.staged !== ' ' && f.staged !== '' ? 0 : f.unstaged === '?' ? 2 : 1)
    files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))

    const branch = status.current ?? 'HEAD (detached)'
    const ahead = status.ahead ?? 0
    const behind = status.behind ?? 0
    const tracking = status.tracking ?? null

    return { path: p, name: path.basename(p), branch, tracking, ahead, behind, files }
}

/* ---------------- Binary / image detection ---------------- */

export async function getDiffMeta(file: string, staged: boolean): Promise<{ binary: boolean; image: boolean }> {
    const { path: p, git: g } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const ext = path.extname(file).toLowerCase()
    const image = IMAGE_EXTS.includes(ext)
    // untracked files produce no git diff/numstat — sniff the file on disk instead
    if (!staged && (await isUntracked(g, file))) {
        return { binary: image ? false : isBinaryFile(p, file), image }
    }
    try {
        const numstat = await g.raw(['diff', ...(staged ? ['--cached'] : []), '--numstat', '--no-color', '--', file])
        const line = numstat.trim().split('\n')[0]
        const binary = !line || line.startsWith('-\t-\t') || line.startsWith('-	-	')
        return { binary, image }
    } catch {
        return { binary: !image, image }
    }
}

function gitBinaryBuffer(cwd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout as Buffer)
        })
    })
}

const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
}

/** Returns a data URL for an image version: workdir | index | head */
export async function getImageVersion(file: string, source: 'workdir' | 'index' | 'head'): Promise<string | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    try {
        let buf: Buffer
        if (source === 'workdir') {
            buf = await fs.promises.readFile(path.join(p, file))
        } else {
            const spec = source === 'index' ? `:${file}` : `HEAD:${file}`
            buf = await gitBinaryBuffer(p, ['cat-file', '-p', spec])
        }
        if (!buf.length) return null
        return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
        return null
    }
}

/* ---------------- Log / Graph ---------------- */

export async function getLog(limit = 500): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%P', '%h', '%an', '%ad', '%d', '%s', '%b'].join(SEP)

    const text = await g.raw(['log', '--all', `--pretty=format:${fmt}${REC}`, '--date=iso', `--max-count=${limit}`, '--'])

    const commits: CommitNode[] = []
    for (const line of text.split(REC)) {
        const t = line.replace(/^\n/, '')
        if (!t.trim()) continue
        const [hash, parents, shortHash, author, date, refsRaw, subject, bodyRaw] = t.split(SEP)
        const refs = refsRaw
            ? refsRaw
                  .trim()
                  .replace(/^\(/, '')
                  .replace(/\)$/, '')
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean)
            : []
        commits.push({
            hash,
            shortHash,
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            author,
            date,
            subject,
            body: bodyRaw ? bodyRaw.trim() || undefined : undefined,
            refs,
            lane: 0,
        })
    }
    assignLanes(commits)
    return commits
}

/** Assign each commit to a visual lane (classic first-parent lane allocator). */
function assignLanes(commits: CommitNode[]): void {
    const lanes: string[] = [] // tip hash per lane
    for (const c of commits) {
        let idx = lanes.indexOf(c.hash)
        if (idx === -1) {
            lanes.push(c.hash)
            idx = lanes.length - 1
        }
        c.lane = idx
        lanes.splice(idx, 1)

        c.parents.forEach((parent, i) => {
            if (!commits.some(x => x.hash === parent)) return // parent beyond log window
            const pi = lanes.indexOf(parent)
            if (pi === -1) {
                if (i === 0)
                    lanes.splice(idx, 0, parent) // first parent inherits position
                else lanes.push(parent)
            }
        })
    }
}

/* ---------------- Staging & Commit ---------------- */

export async function stage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(paths)
}

export async function stageAll(): Promise<void> {
    const { git: g } = getRepo()
    await g.add('-A')
}

export async function unstage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    // use rm --cached --ignore-unmatch so it works in fresh repos without HEAD too
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...paths])
    await g.reset(['HEAD', '--', ...paths]).catch(() => {}) // ignore when no HEAD yet
}

export async function unstageAll(): Promise<void> {
    const { git: g } = getRepo()
    // mixed reset unstages everything without touching the worktree —
    // never enumerate paths here: repos with thousands of staged files
    // (e.g. node_modules) overflow the OS exec arg limit (E2BIG).
    try {
        await g.reset(['--'])
        return
    } catch {
        /* fresh repo without HEAD yet — clear the index instead */
    }
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '.'])
}

export async function discard(path_: string): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    const file = status.files.find(f => f.path === path_)
    if (!file) return
    if (file.working_dir === '?') {
        // untracked -> delete file
        await g.raw(['clean', '-f', '--', path_])
    } else {
        await g.checkout(['--', path_])
    }
}

export async function discardAll(): Promise<void> {
    const { git: g } = getRepo()
    // restore ALL tracked files from the index via a single '.' pathspec —
    // enumerating paths overflows the OS exec arg limit on big repos (E2BIG)
    const status = await g.status()
    if (status.files.some(f => f.working_dir !== '?')) await g.checkout(['--', '.'])
    // untracked files/directories -> remove
    if (status.files.some(f => f.working_dir === '?')) await g.clean(['f', 'd'])
}

export async function commit(message: string): Promise<string> {
    const { git: g } = getRepo()
    const res = await g.commit(message)
    return res.commit
}

/* ---------------- Diff ---------------- */

export async function getDiff(file: string, staged: boolean): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    // untracked files have no HEAD/index entry to diff against — render the
    // whole file as a set of additions so its content can actually be read
    if (!staged && (await isUntracked(g, file))) {
        return getUntrackedDiff(p, file)
    }
    const args = staged ? ['diff', '--cached', '--no-color', '--', file] : ['diff', '--no-color', '--', file]
    let text = ''
    try {
        text = await g.raw(args)
    } catch {
        /* empty diff */
    }
    return parseDiff(text, file)
}

/** true when `git status --porcelain` marks the path as `??` (untracked) */
async function isUntracked(g: SimpleGit, file: string): Promise<boolean> {
    try {
        const out = await g.raw(['status', '--porcelain', '--', file])
        return out.trimStart().startsWith('??')
    } catch {
        return false
    }
}

/** crude binary sniff: a NUL byte in the first 8KB marks the file as binary */
function isBinaryFile(repoPath: string, file: string): boolean {
    try {
        const buf = fs.readFileSync(path.join(repoPath, file))
        return buf.subarray(0, 8000).includes(0)
    } catch {
        return false
    }
}

/** show an untracked file's whole content as an add-only diff */
function getUntrackedDiff(repoPath: string, file: string): DiffLine[] {
    let content = ''
    try {
        content = fs.readFileSync(path.join(repoPath, file), 'utf8')
    } catch {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    }
    const lineTexts = content.split('\n')
    if (lineTexts.length && lineTexts[lineTexts.length - 1] === '') lineTexts.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -0,0 +1,${lineTexts.length} @@` })
    lineTexts.forEach((text, i) => lines.push({ type: 'add', oldNo: null, newNo: i + 1, text: `+${text}` }))
    return lines
}

function parseDiff(text: string, file?: string): DiffLine[] {
    const lines: DiffLine[] = file ? [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }] : []
    let oldNo = 0
    let newNo = 0

    for (const line of text.split('\n')) {
        if (
            line.startsWith('diff ') ||
            line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('similarity ') ||
            line.startsWith('rename ')
        ) {
            continue
        }
        if (line.startsWith('@@')) {
            const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
            oldNo = m ? parseInt(m[1], 10) : 0
            newNo = m ? parseInt(m[2], 10) : 0
            lines.push({ type: 'hunk', oldNo: null, newNo: null, text: line })
        } else if (line.startsWith('+')) {
            lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: line })
        } else if (line.startsWith('-')) {
            lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line })
        } else if (line.startsWith(' ')) {
            lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line })
        } else if (line.startsWith('\\')) {
            lines.push({ type: 'meta', oldNo: null, newNo: null, text: line })
        }
    }
    return lines
}

export async function getCommitDetails(hash: string): Promise<CommitDetails> {
    const { git: g } = getRepo()
    const [metadata, message, diffText, fileText, numstatText] = await Promise.all([
        g.raw(['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P', hash]),
        g.raw(['show', '-s', '--format=%B', hash]),
        g.raw(['show', '--no-color', '--format=', hash]),
        g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
        g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
    ])
    const [fullHash, author, email, date, parents = ''] = metadata.trim().split('\u001f')

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
        diff: parseDiff(diffText),
    }
}

/* ---------------- Stash ---------------- */

export async function listStashes(): Promise<StashEntry[]> {
    const { git: g } = getRepo()
    const raw = await g.raw(['stash', 'list', '--format=%gd%x00%H%x00%ci%x00%B'])
    return raw
        .split(/\n(?=stash@\{)/)
        .filter(Boolean)
        .map(line => {
            const [ref, hash, date, ...messageParts] = line.split('\x00')
            const match = /stash@\{(\d+)\}/.exec(ref)
            return { index: match ? Number(match[1]) : 0, hash, date, message: messageParts.join('\x00').trimEnd() }
        })
}

export async function createStash(message: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['stash', 'push', '--include-untracked', '-m', message || 'WIP'])
}

export async function applyStash(index: number, pop: boolean): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function dropStash(index: number): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['stash', 'drop', `stash@{${index}}`])
}

export async function revertCommit(hash: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['revert', '--no-edit', hash])
}

export async function checkoutCommit(hash: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(hash)
}

/* ---------------- Branches ---------------- */

export async function listBranches(): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> {
    const { git: g } = getRepo()
    const b = await g.branch(['-a'])
    const local: BranchInfo[] = []
    const remote: BranchInfo[] = []

    // ahead/behind counts vs upstream + tip commit SHA, per ref
    // (note: Apple Git does not expand %x1f in for-each-ref format, use | as separator;
    //  simple-git's branch().commit is only the abbreviated hash — use %(objectname) for full SHAs)
    const trackText = await g.raw([
        'for-each-ref',
        '--format=%(refname:short)|%(upstream:track)|%(objectname)',
        'refs/heads',
        'refs/remotes',
    ])
    const track = new Map<string, { ahead?: number; behind?: number; commitHash?: string }>()
    for (const line of trackText.split('\n')) {
        if (!line.trim()) continue
        const [name, t = '', commitHash = ''] = line.split('|')
        if (name.endsWith('/HEAD')) continue
        const ahead = /\bahead (\d+)/.exec(t)?.[1]
        const behind = /\bbehind (\d+)/.exec(t)?.[1]
        track.set(name, {
            ...(ahead ? { ahead: Number(ahead) } : {}),
            ...(behind ? { behind: Number(behind) } : {}),
            ...(commitHash ? { commitHash } : {}),
        })
    }

    for (const ref of b.all) {
        if (ref.includes('HEAD') || ref.includes('->')) continue
        const info: BranchInfo = { name: ref, current: b.current === ref }
        Object.assign(info, track.get(ref) ?? track.get(ref.replace(/^remotes\//, '')))
        if (ref.startsWith('remotes/') || !b.branches[ref]) remote.push(info)
        else local.push(info)
    }
    return { local, remote }
}

export async function createBranch(name: string, checkout: boolean): Promise<void> {
    const { git: g } = getRepo()
    if (checkout) await g.checkoutBranch(name, 'HEAD')
    else await g.raw(['branch', name])
}

export async function checkout(ref: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(ref)
}

export async function deleteBranch(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.deleteLocalBranch(name, true /* force */)
}

export async function merge(name: string): Promise<string> {
    const { git: g } = getRepo()
    const res = await g.merge([name, '--no-edit'])
    return res.result || 'Merged'
}

/* ---------------- Remotes ---------------- */

export async function fetchAll(): Promise<string> {
    const { git: g } = getRepo()
    await g.fetch(['--all', '--tags'])
    return 'Fetch completed'
}

export async function push(): Promise<string> {
    const { git: g } = getRepo()
    const status = await g.status()
    const branch = status.current
    const tracking = status.tracking
    if (tracking) await g.push()
    else await g.push(['--set-upstream', 'origin', branch as string])
    return 'Pushed successfully'
}

export async function pull(): Promise<string> {
    const { git: g } = getRepo()
    const res = await g.pull(['--no-rebase'])
    return `Pulled (${res.summary.changes} changes)`
}

export async function hasRemote(): Promise<boolean> {
    const { git: g } = getRepo()
    const remotes = await g.getRemotes()
    return remotes.length > 0
}

/* ---------------- Repo state / conflicts / rebase / advanced ---------------- */

export function getRepoState(): RepoState {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    const merging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
    const rebasing = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
    const bisectActive = fs.existsSync(path.join(gitDir, 'BISECT_START')) || fs.existsSync(path.join(gitDir, 'BISECT_LOG'))
    return { merging, rebasing, bisectActive }
}

export async function checkoutSide(file: string, side: 'ours' | 'theirs'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file])
    await g.add(file)
}

export async function markResolved(files: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(files)
}

export async function continueMerge(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['commit', '--no-edit'])
}

export async function abortMerge(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['merge', '--abort'])
}

export async function rebaseOnto(ref: string): Promise<string> {
    const { git: g } = getRepo()
    try {
        await g.raw(['rebase', ref])
        return `Rebased onto ${ref}`
    } catch {
        // conflict or error — state is exposed via getRepoState(); caller decides to abort/continue
        const state = await getRepoState()
        if (state.rebasing || state.merging) throw new Error('Rebase stopped due to conflicts. Resolve them, then continue.')
        throw new Error('Rebase failed')
    }
}

export async function rebaseAbort(): Promise<void> {
    const { git: g } = getRepo()
    await g.env({ ...process.env, GIT_EDITOR: 'true' }).raw(['rebase', '--abort'])
}

export async function rebaseContinue(): Promise<void> {
    const { git: g } = getRepo()
    await g.env({ ...process.env, GIT_EDITOR: 'true' }).raw(['rebase', '--continue'])
}

export async function cherryPick(hash: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['cherry-pick', hash])
}

export async function resetTo(target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['reset', `--${mode}`, target])
}

export async function renameBranch(oldName: string, newName: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['branch', '-m', oldName, newName])
}

export async function getCommitFileDiff(hash: string, file: string): Promise<DiffLine[]> {
    const { git: g } = getRepo()
    let text = ''
    try {
        text = await g.raw(['show', '--no-color', '--format=', hash, '--', file])
    } catch {
        /* empty */
    }
    return parseDiff(text)
}

/* ---------------- Interactive rebase (todo editor) ---------------- */

export async function getRebasePlan(baseRef: string): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
    const text = await g.raw(['log', '--reverse', `--pretty=format:${fmt}${REC}`, `${baseRef}..HEAD`, '--'])
    return text
        .split(REC)
        .map(line => line.replace(/^\n/, ''))
        .filter(line => line.trim())
        .map(line => {
            const [hash, shortHash, author, date, subject] = line.split(SEP)
            return { hash, shortHash, parents: [], author, date, subject, refs: [], lane: 0 }
        })
}

/* ================= WP1: Amend commit ================= */

export async function commitMessage(message: string, amend: boolean): Promise<string> {
    const { git: g } = getRepo()
    if (amend && !message.trim()) throw new Error('Enter a message to amend with')
    // NOTE: simple-git already prefixes each message with -m — passing ['-m', …]
    // would make the first -m consume the literal "-m" as the subject
    const res = amend ? await g.commit(message, [], ['--amend']) : await g.commit(message)
    return res.commit
}

export async function getLastCommitMessage(): Promise<string> {
    const { git: g } = getRepo()
    return (await g.raw(['log', '-1', '--format=%B'])).trim()
}

/* ================= WP2: Tags ================= */

export interface TagRef {
    name: string
    hash: string
}

export async function listTags(): Promise<TagRef[]> {
    const { git: g } = getRepo()
    // NOTE: for-each-ref does NOT expand %x1f escapes (only pretty-format does),
    // so the separator must be a real control character embedded in the string.
    // %(*objectname) = peeled commit hash (present only for annotated tags);
    // fall back to %(objectname) for lightweight tags
    const SEP = '\x1f'
    const text = await g.raw([
        'for-each-ref',
        'refs/tags',
        `--format=%(refname:short)${SEP}%(*objectname)${SEP}%(objectname)`,
    ])
    return text
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [name, peeled, object] = line.split(SEP)
            return { name, hash: peeled || object }
        })
}

export async function createTag(name: string, targetHash: string | null, message?: string): Promise<void> {
    const { git: g } = getRepo()
    if (!name.trim()) throw new Error('Tag name is required')
    const args = ['tag']
    if (message?.trim()) args.push('-a', name.trim(), '-m', message.trim())
    else args.push(name.trim())
    if (targetHash) args.push(targetHash)
    await g.raw(args)
}

export async function deleteTag(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['tag', '-d', name])
}

export async function pushTags(): Promise<string> {
    const { git: g } = getRepo()
    await g.push(['origin', '--tags'])
    return 'Tags pushed'
}

/** Push a single local tag to origin. */
export async function pushTag(name: string): Promise<string> {
    const { git: g } = getRepo()
    await g.push(['origin', `refs/tags/${name.trim()}`])
    return `Tag ${name.trim()} pushed`
}

/** Names of tags that already exist on origin, via ls-remote (network). */
export async function listRemoteTags(): Promise<string[]> {
    const { git: g } = getRepo()
    try {
        const out = await g.raw(['ls-remote', '--tags', 'origin'])
        const names = new Set<string>()
        for (const line of out.split('\n')) {
            const ref = line.split('\t')[1] ?? ''
            if (!ref.startsWith('refs/tags/')) continue
            // drop the peeled ^{} line of annotated tags so each tag counts once
            names.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''))
        }
        return [...names]
    } catch {
        return [] // offline / no remote — never crash the UI
    }
}

/** Delete a tag on the remote (does not touch the local tag). */
export async function deleteRemoteTag(name: string): Promise<string> {
    const { git: g } = getRepo()
    await g.push(['origin', `:refs/tags/${name.trim()}`])
    return `Remote tag ${name.trim()} deleted`
}

/* ================= WP3: Remotes ================= */

export async function listRemotes(): Promise<{ name: string; url: string }[]> {
    const { path: p, git: g } = getRepo()
    const remotes = await g.getRemotes(true)
    void p
    return remotes.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }))
}

export async function addRemote(name: string, url: string): Promise<void> {
    const { git: g } = getRepo()
    if (!name.trim() || !url.trim()) throw new Error('Name and URL are required')
    await g.raw(['remote', 'add', name.trim(), url.trim()])
}

export async function removeRemote(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['remote', 'remove', name])
}

export async function setRemoteUrl(name: string, url: string): Promise<void> {
    const { git: g } = getRepo()
    if (!url.trim()) throw new Error('URL is required')
    await g.raw(['remote', 'set-url', name, url.trim()])
}

/** Probe a remote URL with `git ls-remote` (works outside a repo, no creds needed to start). */
export async function testRemoteUrl(rawUrl: string): Promise<RemoteTestResult> {
    const url = String(rawUrl ?? '').trim()
    if (!url) return { ok: false, message: 'Enter a remote URL first' }
    try {
        await new Promise<void>((resolve, reject) => {
            execFile('git', ['ls-remote', url, 'HEAD'], { timeout: 20_000 }, err => {
                if (err) reject(new Error(err instanceof Error ? err.message : String(err)))
                else resolve()
            })
        })
        log('info', 'git', `remote url test ok (${maskUrl(url)})`)
        return { ok: true, message: 'Remote URL is reachable' }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('warn', 'git', `remote url test failed (${maskUrl(url)}): ${message.slice(0, 200)}`)
        return { ok: false, message: message.slice(0, 300) }
    }
}

/* ================= WP4: Hunk-level staging ================= */

export async function getRawPatch(file: string, staged: boolean): Promise<string> {
    const { git: g } = getRepo()
    try {
        return await g.raw(['diff', ...(staged ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--', file])
    } catch {
        return ''
    }
}

/** Uncommitted changes, used as the AI commit-message context.
 * Staged-only scope when anything is staged (matches what the commit will include),
 * otherwise falls back to all uncommitted changes (staged + unstaged + untracked). */
export async function getChangesContext(): Promise<string> {
    const { path: p, git: g } = getRepo()
    const parts: string[] = []

    let stagedFiles: string[] = []
    let allLines: string[] = []
    try {
        const statusText = await g.raw(['status', '--porcelain'])
        allLines = statusText.split('\n').map(line => line.trimEnd()).filter(Boolean)
        // porcelain: column 1 = index/staged state (' ' or '?' means not staged)
        stagedFiles = allLines.filter(line => line[0] !== ' ' && line[0] !== '?')
    } catch {
        /* ignore */
    }

    if (stagedFiles.length > 0) {
        // staged-only scope — the user is preparing a specific commit
        parts.push(`Changed files (staged for commit):\n${stagedFiles.join('\n')}`)
        try {
            const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
            if (staged.trim()) parts.push(staged)
        } catch {
            /* no HEAD yet */
        }
        return parts.join('\n')
    }

    // nothing staged → summarize everything uncommitted
    if (allLines.length) parts.push(`Changed files:\n${allLines.join('\n')}`)
    try {
        const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
        const unstaged = await g.raw(['diff', '--no-color', '--no-ext-diff'])
        if (staged.trim()) parts.push(staged)
        if (unstaged.trim()) parts.push(unstaged)
    } catch {
        /* no HEAD yet / no tracked changes */
    }
    // untracked files never appear in a git diff — attach paths + small content
    try {
        const untracked = await g.raw(['ls-files', '--others', '--exclude-standard'])
        const files = untracked.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10)
        if (files.length) {
            const block = files
                .map(file => {
                    try {
                        const content = fs.readFileSync(path.join(p, file), 'utf8').slice(0, 4000)
                        return `--- ${file} (new) ---\n${content}`
                    } catch {
                        return `--- ${file} (new) ---`
                    }
                })
                .join('\n')
            parts.push(block)
        }
    } catch {
        /* ignore */
    }
    return parts.join('\n')
}

function writeTempPatch(patch: string): string {
    const tmp = path.join(path.dirname(getRepo().path), '.git', `open-git-patch-${Date.now()}.patch`)
    fs.writeFileSync(tmp, patch.endsWith('\n') ? patch : `${patch}\n`)
    return tmp
}

/** Apply a partial patch. target 'index' = stage/unstage; 'worktree' = discard/restore */
export async function applyPatch(patch: string, target: 'index' | 'worktree', reverse: boolean): Promise<void> {
    const { git: g } = getRepo()
    if (!patch.trim()) throw new Error('Empty patch')
    const tmp = writeTempPatch(patch)
    const args = ['apply', '--whitespace=nowarn']
    if (target === 'index') args.push('--cached')
    if (reverse) args.push('--reverse')
    args.push(tmp)
    try {
        await g.raw(args)
    } catch (err) {
        throw new Error(
            String(err)
                .replace(/^Error:\s*(spawn|fatal:)?\s*/i, '')
                .slice(0, 300)
        )
    } finally {
        fs.promises.unlink(tmp).catch(() => {})
    }
}

/** Build a patch containing only the selected hunks of a file's diff */
export async function stageHunks(file: string, stagedView: boolean, hunkIndexes: number[], reverse: boolean): Promise<void> {
    const raw = await getRawPatch(file, stagedView)
    if (!raw.trim()) throw new Error('No changes found')

    // split into header lines and hunks
    const lines = raw.split('\n')
    const hunkStarts: number[] = []
    lines.forEach((line, i) => {
        if (line.startsWith('@@')) hunkStarts.push(i)
    })
    if (!hunkStarts.length) throw new Error('No hunks in this diff')

    const firstHunkLine = hunkStarts[0]
    const header = lines.slice(0, firstHunkLine)

    const hunkBlocks = hunkStarts.map((start, i) => {
        const end = i + 1 < hunkStarts.length ? hunkStarts[i + 1] : lines.length
        return lines.slice(start, end)
    })

    const chosen = hunkIndexes
        .filter(i => i >= 0 && i < hunkBlocks.length)
        .sort((a, b) => a - b)
        .map(i => hunkBlocks[i].join('\n'))
    if (!chosen.length) throw new Error('No hunks selected')

    const patch = [...header, ...chosen].join('\n')
    await applyPatch(patch, 'index', reverse)
}

/* ================= WP5: Blame & file history ================= */

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

export async function getBlame(file: string): Promise<BlameLine[]> {
    const { git: g } = getRepo()
    const text = await g.raw(['blame', '--line-porcelain', '--', file])
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
            })
            continue
        }
        const spaceAt = line.indexOf(' ')
        const key = spaceAt === -1 ? line : line.slice(0, spaceAt)
        const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1)
        if (/^[0-9a-f]{40}$/.test(key)) current.hash = key
        else if (key === 'author') current.author = value
        else if (key === 'author-time') current.date = new Date(parseInt(value, 10) * 1000).toISOString()
        else if (/^\d+$/.test(key)) current.lineNumber = parseInt(key, 10)
    }
    return result
}

/* ================= WP6: Rebase edit/split (pause/resume) ================= */

const BACKUP_FILE = 'open-git-rebase-backup'

function backupPath(): string {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    return path.join(gitDir, BACKUP_FILE)
}

export async function executeRebasePlan(baseRef: string, entries: RebaseEntry[], resume: boolean): Promise<RebaseOutcome> {
    const { git: g } = getRepo()

    const backupFile = backupPath()
    const status = await g.status()
    const branch = status.current

    let origHead: string
    if (resume) {
        if (!fs.existsSync(backupFile)) throw new Error('No paused rebase found')
        origHead = fs.readFileSync(backupFile, 'utf8').trim()
    } else {
        if (!entries.length) throw new Error('Nothing to rebase')
        origHead = await g.revparse(['HEAD'])
        fs.writeFileSync(backupFile, origHead)
        await g.raw(['reset', '--hard', baseRef])
    }

    const rollback = async () => {
        await g.raw(['cherry-pick', '--abort']).catch(() => {})
        await g.raw(['reset', '--hard', origHead]).catch(() => {})
        if (branch && branch !== 'HEAD') await g.checkout(branch).catch(() => {})
        fs.promises.unlink(backupFile).catch(() => {})
    }

    try {
        for (const entry of entries) {
            if (entry.command === 'drop') continue
            // oxlint-disable-next-line no-await-in-loop
            await g.raw(['cherry-pick', '--allow-empty', '--keep-redundant-commits', entry.hash])

            switch (entry.command) {
                case 'reword':
                    // oxlint-disable-next-line no-await-in-loop
                    await g.commit(entry.message || 'Reworded commit', [], ['--amend'])
                    break
                case 'squash':
                case 'fixup': {
                    // oxlint-disable-next-line no-await-in-loop
                    await g.raw(['reset', '--soft', 'HEAD~1'])
                    // oxlint-disable-next-line no-await-in-loop
                    if (entry.command === 'squash' && entry.message?.trim()) await g.commit(entry.message)
                    // oxlint-disable-next-line no-await-in-loop
                    else await g.raw(['commit', '--no-edit'])
                    break
                }
                case 'edit':
                    // pause: user amends the commit manually, then continues
                    return { completed: false, message: `Paused at ${entry.hash.slice(0, 7)} for editing` }
                case 'split':
                    // pause: uncommit but keep its changes staged so user can commit pieces
                    // oxlint-disable-next-line no-await-in-loop
                    await g.raw(['reset', '--soft', 'HEAD~1'])
                    return { completed: false, message: `Paused after unpacking ${entry.hash.slice(0, 7)} — its changes are staged` }
            }
        }

        fs.promises.unlink(backupFile).catch(() => {})
        const replayed = entries.filter(e => e.command !== 'drop').length
        return { completed: true, message: `Interactive rebase complete (${replayed} commits)` }
    } catch {
        await rollback()
        throw new Error('Rebase failed — repository restored to its original state')
    }
}

export async function abortPausedRebase(): Promise<void> {
    const { git: g } = getRepo()
    const backupFile = backupPath()
    if (!fs.existsSync(backupFile)) throw new Error('No paused rebase to abort')
    const origHead = fs.readFileSync(backupFile, 'utf8').trim()
    await g.raw(['cherry-pick', '--abort']).catch(() => {})
    await g.raw(['reset', '--hard', origHead])
    const status = await g.status()
    if (status.current !== 'HEAD' && status.current) await g.checkout(status.current).catch(() => {})
    fs.promises.unlink(backupFile).catch(() => {})
}

/* ================= WP7: Bisect ================= */

export async function bisectStart(badRef: string, goodRef?: string): Promise<void> {
    const { git: g } = getRepo()
    const args = ['bisect', 'start', badRef]
    if (goodRef?.trim()) args.push(goodRef.trim())
    await g.raw(args)
}

export async function bisectMark(kind: 'good' | 'bad' | 'skip'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['bisect', kind])
}

export async function bisectReset(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['bisect', 'reset'])
}

/* ================= WP8: Worktrees & submodules ================= */

export async function listWorktrees(): Promise<WorktreeInfo[]> {
    const { git: g } = getRepo()
    const text = await g.raw(['worktree', 'list', '--porcelain'])
    const result: WorktreeInfo[] = []
    let currentWt: Partial<WorktreeInfo> = {}
    for (const line of text.split('\n')) {
        if (line.startsWith('worktree ')) {
            if (currentWt.path) result.push(finalizeWorktree(currentWt))
            currentWt = { path: line.slice('worktree '.length) }
        } else if (line.startsWith('HEAD ')) currentWt.head = line.slice(5)
        else if (line.startsWith('branch ')) currentWt.branch = line.slice('branch refs/heads/'.length)
    }
    if (currentWt.path) result.push(finalizeWorktree(currentWt))
    return result
}
function finalizeWorktree(wt: Partial<WorktreeInfo>): WorktreeInfo {
    return { path: wt.path ?? '', head: wt.head ?? '', branch: wt.branch ?? null }
}

export async function addWorktree(dir: string, newBranch?: string): Promise<void> {
    const { git: g } = getRepo()
    if (!dir.trim()) throw new Error('Path is required')
    const args = ['worktree', 'add']
    if (newBranch?.trim()) args.push('-b', newBranch.trim())
    args.push(dir.trim())
    if (newBranch?.trim()) args.push('HEAD')
    await g.raw(args)
}

export async function removeWorktree(dir: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['worktree', 'remove', dir])
}

export function listSubmodules(): string[] {
    const { path: p } = getRepo()
    const modulesFile = path.join(p, '.gitmodules')
    if (!fs.existsSync(modulesFile)) return []
    const content = fs.readFileSync(modulesFile, 'utf8')
    return [...content.matchAll(/submodule "([^"]+)"/g)].map(match => match[1])
}

export async function updateSubmodules(): Promise<string> {
    const { git: g } = getRepo()
    await g.submoduleUpdate(['--init', '--recursive'])
    return 'Submodules updated'
}
