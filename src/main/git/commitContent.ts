import * as path from 'node:path'

import { capDiffLines, parseDiff } from '../parsers'
import { getRepo } from './repo'
import { gitBinaryBuffer, MIME_BY_EXT, snapshotToCtxLines, toFileContent } from './util'

import type { DiffLine, DiffMeta, FileContent, GitImage } from '@shared/types'

/** Commit-browsing slice: per-file diff, meta, image and preview content at a commit. */

export async function getCommitFileDiff(hash: string, file: string, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    let text = ''
    try {
        const parents = (await g.raw(['show', '-s', '--format=%P', hash])).trim().split(/\s+/).filter(Boolean)
        text = parents.length
            ? await g.raw(['diff', parents[0], hash, `--unified=${context ?? 3}`, '--no-color', '--', file])
            : await g.raw(['show', `--unified=${context ?? 3}`, '--no-color', '--format=', hash, '--', file])
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text))

    let snapshot: Buffer
    try {
        snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
    } catch {
        return []
    }
    if (snapshot.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    const content = snapshot.toString('utf8')
    return capDiffLines(snapshotToCtxLines(file, content))
}

export async function getCommitFileMeta(hash: string, file: string): Promise<DiffMeta> {
    const { path: p } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const image = IMAGE_EXTS.includes(path.extname(file).toLowerCase())
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        return { binary: snapshot.subarray(0, 8000).includes(0), image }
    } catch {
        return { binary: false, image: false }
    }
}

export async function getCommitImageVersion(hash: string, file: string): Promise<GitImage | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        return snapshot.length ? { mime, data: snapshot } : null
    } catch {
        return null
    }
}

/** Blob content at a commit for read-only preview. */
export async function getCommitFileContent(hash: string, file: string): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        return toFileContent(await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`]))
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
}
