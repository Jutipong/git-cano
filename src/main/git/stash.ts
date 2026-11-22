import * as path from 'node:path'

import { capDiffLines, parseDiff, parseNameStatus, parseNumstatMap } from '../parsers'
import { getRepo } from './repo'
import { pushUndo } from './undo'
import { gitBinaryBuffer, MIME_BY_EXT, snapshotToCtxLines, toFileContent } from './util'

import type { CommitFile, DiffLine, DiffMeta, FileContent, GitImage, StashEntry } from '@shared/types'

/** Stash slice: stash list/apply/drop plus the stash file tree, diffs and previews. */

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
    const { path: p, git: g } = getRepo()
    // Capture the entry before dropping — `git stash store` can recreate it for Undo.
    const doomed = await listStashes()
        .then(entries => entries.find(entry => entry.index === index))
        .catch(() => undefined)
    await g.raw(['stash', 'drop', `stash@{${index}}`])
    if (doomed) {
        pushUndo({
            label: 'stash delete',
            doneMessage: 'Stash restored',
            repoPath: p,
            kind: 'dropStash',
            stashHash: doomed.hash,
            stashMessage: doomed.message,
        })
    }
}

// A stash is a merge commit: diff-tree/show against it directly don't work.
// Always diff against its first parent (the branch tip at stash time).
export async function getStashFiles(hash: string): Promise<CommitFile[]> {
    const { git: g } = getRepo()
    const [nameStatus, numstat, parents] = await Promise.all([
        g.raw(['diff', `${hash}^`, hash, '--no-color', '--name-status', '-r']),
        g.raw(['diff', `${hash}^`, hash, '--no-color', '--numstat', '-r']),
        g.raw(['show', '-s', '--format=%P', hash]),
    ])
    const files = parseNameStatus(nameStatus, parseNumstatMap(numstat))
    // 3rd parent of `stash push --include-untracked` holds the untracked files
    if (parents.trim().split(' ').filter(Boolean).length >= 3) {
        const [untrackedStatus, untrackedNumstat] = await Promise.all([
            g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', `${hash}^3`]),
            g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', `${hash}^3`]),
        ])
        files.push(...parseNameStatus(untrackedStatus, parseNumstatMap(untrackedNumstat)))
    }
    return files
}

function stashBlobAddedLines(file: string, snapshot: Buffer): DiffLine[] {
    const lineTexts = snapshot.toString('utf8').split('\n')
    if (lineTexts.length && lineTexts[lineTexts.length - 1] === '') lineTexts.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -0,0 +1,${lineTexts.length} @@` })
    lineTexts.forEach((text, i) => lines.push({ type: 'add', oldNo: null, newNo: i + 1, text: `+${text}` }))
    return lines
}

export async function getStashFileDiff(hash: string, file: string, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    let text = ''
    try {
        text = await g.raw(['diff', `${hash}^`, hash, `--unified=${context ?? 3}`, '--no-color', '--', file])
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text))

    // Empty diff: unchanged files (opened from ALL FILES mode) render the stash-tree blob
    // as context; untracked files kept in the 3rd parent keep their added-lines rendering.
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        if (snapshot.subarray(0, 8000).includes(0)) {
            return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
        }
        return capDiffLines(snapshotToCtxLines(file, snapshot.toString('utf8')))
    } catch {
        // not in the stash tree — fall through to the 3rd-parent check below
    }
    // empty tracked diff + untracked file kept in the stash's 3rd parent
    let snapshot: Buffer
    try {
        snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`])
    } catch {
        return []
    }
    if (snapshot.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    return capDiffLines(stashBlobAddedLines(file, snapshot))
}

export async function getStashFileMeta(hash: string, file: string): Promise<DiffMeta> {
    const { path: p } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const image = IMAGE_EXTS.includes(path.extname(file).toLowerCase())
    // tracked blob lives in the stash tree; untracked one in the 3rd parent
    const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`]))
        .catch(() => null)
    if (!snapshot) return { binary: false, image: false }
    return { binary: snapshot.subarray(0, 8000).includes(0), image }
}

export async function getStashImageVersion(hash: string, file: string): Promise<GitImage | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`]))
        .catch(() => null)
    if (!snapshot?.length) return null
    return { mime, data: snapshot }
}

/** Blob content in a stash (untracked files live in the 3rd parent) for read-only preview. */
export async function getStashFileContent(hash: string, file: string): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        const buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`]).catch(() =>
            gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`])
        )
        return toFileContent(buf)
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
}
