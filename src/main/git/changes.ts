import * as fs from 'node:fs'
import * as path from 'node:path'

import { capContextSection, capDiffLines, parseDiff } from '../parsers'
import { getRepo, getRepoFor } from './repo'
import { gitBinaryBuffer, isBinaryFile, isUntracked, resolveGitDir, snapshotToCtxLines } from './util'

import type { AiContextScope, DiffLine, DiffMeta } from '@shared/types'

/** Working-tree changes slice: staging, discarding, diffs, hunk patches and the AI change-context builder. */

export async function stage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(paths)
}

export async function stageAll(dir?: string): Promise<void> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    await g.add('-A')
}

export async function unstage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...paths])
    await g.reset(['HEAD', '--', ...paths]).catch(() => {})
}

export async function unstageAll(): Promise<void> {
    const { git: g } = getRepo()
    try {
        await g.reset(['--'])
        return
    } catch {}
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '.'])
}

export async function discard(path_: string): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    const file = status.files.find(f => f.path === path_)
    if (!file) return
    if (file.working_dir === '?') {
        await g.raw(['clean', '-f', '--', path_])
    } else {
        await g.checkout(['--', path_])
    }
}

export async function discardUnstaged(): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    if (status.files.some(f => f.working_dir !== '?')) await g.checkout(['--', '.'])
}

export async function getDiffMeta(file: string, staged: boolean): Promise<DiffMeta> {
    const { path: p, git: g } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const ext = path.extname(file).toLowerCase()
    const image = IMAGE_EXTS.includes(ext)
    if (!staged && (await isUntracked(g, file))) {
        return { binary: image ? false : isBinaryFile(p, file), image }
    }
    try {
        const numstat = await g.raw(['diff', ...(staged ? ['--cached'] : []), '--numstat', '--no-color', '--', file])
        const line = numstat.trim().split('\n')[0]
        if (!line) {
            // Empty numstat = no changes (ALL FILES mode can open unchanged files).
            // Probe the content getDiff() will display instead of mislabeling it binary.
            if (staged) {
                try {
                    const blob = await gitBinaryBuffer(p, ['cat-file', '-p', `:${file}`])
                    return { binary: blob.subarray(0, 8000).includes(0), image }
                } catch {
                    return { binary: false, image }
                }
            }
            return { binary: isBinaryFile(p, file), image }
        }
        const binary = !line || line.startsWith('-\t-\t') || line.startsWith('-	-	')
        return { binary, image }
    } catch {
        return { binary: !image, image }
    }
}

export async function getDiff(file: string, staged: boolean, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    if (!staged && (await isUntracked(g, file))) {
        return capDiffLines(getUntrackedDiff(p, file))
    }
    const unified = `--unified=${context ?? 3}`
    const args = staged ? ['diff', '--cached', unified, '--no-color', '--', file] : ['diff', unified, '--no-color', '--', file]
    let text = ''
    try {
        text = await g.raw(args)
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text, file))
    // Empty diff = unchanged file (opened from ALL FILES mode) — show the full content
    // like Fork/GitKraken's file tree instead of an empty diff.
    return capDiffLines(await fullFileLines(p, file, staged))
}

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

/**
 * Full-content fallback for unchanged files (ALL FILES mode): renders the blob as context lines so the viewer shows code like
 * Fork/GitKraken instead of an empty diff. `staged` selects the index blob, otherwise the working-tree file.
 */
async function fullFileLines(repoPath: string, file: string, staged: boolean): Promise<DiffLine[]> {
    let buf: Buffer | null = null
    if (staged) {
        try {
            buf = await gitBinaryBuffer(repoPath, ['cat-file', '-p', `:${file}`])
        } catch {
            buf = null
        }
    } else {
        try {
            buf = await fs.promises.readFile(path.join(repoPath, file))
        } catch {
            buf = null
        }
    }
    if (!buf) return []
    if (buf.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    return snapshotToCtxLines(file, buf.toString('utf8'))
}

export async function getRawPatch(file: string, staged: boolean): Promise<string> {
    const { git: g } = getRepo()
    try {
        return await g.raw(['diff', ...(staged ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--', file])
    } catch {
        return ''
    }
}

function writeTempPatch(patch: string): string {
    // The patch must live inside the repo's own git dir — `path.dirname(repo)` pointed at the parent
    // directory, so hunk staging failed with ENOENT for any repo whose parent has no `.git`.
    // resolveGitDir() also handles linked worktrees where `.git` is a pointer file.
    const tmp = path.join(resolveGitDir(getRepo().path), `git-cano-patch-${Date.now()}.patch`)
    fs.writeFileSync(tmp, patch.endsWith('\n') ? patch : `${patch}\n`)
    return tmp
}

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

export async function stageHunks(file: string, stagedView: boolean, hunkIndexes: number[], reverse: boolean): Promise<void> {
    const raw = await getRawPatch(file, stagedView)
    if (!raw.trim()) throw new Error('No changes found')

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

export async function getChangesContext(scope: AiContextScope = 'staged', dir?: string): Promise<string> {
    const { path: p, git: g } = dir ? getRepoFor(dir) : getRepo()
    const parts: string[] = []

    let stagedFiles: string[] = []
    let allLines: string[] = []
    try {
        const statusText = await g.raw(['status', '--porcelain'])
        allLines = statusText
            .split('\n')
            .map(line => line.trimEnd())
            .filter(Boolean)
        stagedFiles = allLines.filter(line => line[0] !== ' ' && line[0] !== '?')
    } catch {}

    if (scope === 'staged' && stagedFiles.length > 0) {
        parts.push(capContextSection(`Changed files (staged for commit):\n${stagedFiles.join('\n')}`))
        try {
            const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
            if (staged.trim()) parts.push(capContextSection(staged))
        } catch {}
        return parts.join('\n')
    }

    if (allLines.length) parts.push(capContextSection(`Changed files:\n${allLines.join('\n')}`))
    try {
        const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
        const unstaged = await g.raw(['diff', '--no-color', '--no-ext-diff'])
        if (staged.trim()) parts.push(capContextSection(staged))
        if (unstaged.trim()) parts.push(capContextSection(unstaged))
    } catch {}
    try {
        const untracked = await g.raw(['ls-files', '--others', '--exclude-standard'])
        const files = untracked
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 10)
        if (files.length) {
            const block = files
                .map(file => {
                    try {
                        const abs = path.join(p, file)
                        if (fs.statSync(abs).size > 256 * 1024) return `--- ${file} (new, large file — content omitted) ---`
                        const buf = fs.readFileSync(abs)
                        if (buf.subarray(0, 8000).includes(0)) return `--- ${file} (new, binary file — content omitted) ---`
                        return `--- ${file} (new) ---\n${buf.toString('utf8').slice(0, 2000)}`
                    } catch {
                        return `--- ${file} (new) ---`
                    }
                })
                .join('\n')
            parts.push(block)
        }
    } catch {}
    return parts.join('\n')
}
