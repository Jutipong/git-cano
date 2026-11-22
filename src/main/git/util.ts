import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { DiffLine, FileContent } from '@shared/types'
import type { SimpleGit } from 'simple-git'

/** Shared low-level git/fs helpers used by more than one feature slice. No feature logic lives here. */

export const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
}

export function gitBinaryBuffer(cwd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout as Buffer)
        })
    })
}

export function isBinaryFile(repoPath: string, file: string): boolean {
    try {
        const buf = fs.readFileSync(path.join(repoPath, file))
        return buf.subarray(0, 8000).includes(0)
    } catch {
        return false
    }
}

export async function isUntracked(g: SimpleGit, file: string): Promise<boolean> {
    try {
        const out = await g.raw(['status', '--porcelain', '--', file])
        return out.trimStart().startsWith('??')
    } catch {
        return false
    }
}

/** Shared blob → context-lines rendering used by the commit/stash/workdir snapshot fallbacks. */
export function snapshotToCtxLines(file: string, content: string): DiffLine[] {
    const snapshotLines = content.split('\n')
    if (snapshotLines[snapshotLines.length - 1] === '') snapshotLines.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `snapshot ${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -1,${snapshotLines.length} +1,${snapshotLines.length} @@` })
    snapshotLines.forEach((line, index) => {
        lines.push({ type: 'ctx', oldNo: index + 1, newNo: index + 1, text: ` ${line}` })
    })
    return lines
}

/** Resolves the actual git dir — handles linked worktrees where `.git` is a pointer file. */
export function resolveGitDir(dir: string): string {
    const dotGit = path.join(dir, '.git')
    try {
        if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
            const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))
            if (match) return path.resolve(dir, match[1].trim())
        }
    } catch {}
    return dotGit
}

/** The repo's `.git` path when it exists, else the repo path itself (bare-ish layouts). */
export function gitDirFor(repoPath: string): string {
    return fs.existsSync(path.join(repoPath, '.git')) ? path.join(repoPath, '.git') : repoPath
}

/** Max bytes read for read-only preview (markdown / JSON) — larger files report tooLarge. */
export const PREVIEW_MAX_BYTES = 1024 * 1024

export function toFileContent(buf: Buffer | null): FileContent {
    if (!buf) return { content: null, binary: false, tooLarge: false }
    if (buf.length > PREVIEW_MAX_BYTES) return { content: null, binary: false, tooLarge: true }
    if (buf.subarray(0, 8000).includes(0)) return { content: null, binary: true, tooLarge: false }
    return { content: buf.toString('utf8'), binary: false, tooLarge: false }
}
