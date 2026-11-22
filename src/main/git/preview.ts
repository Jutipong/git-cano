import * as fs from 'node:fs'
import * as path from 'node:path'

import { resolveMarkdownImagePath } from '@shared/markdownImages'

import { getRepo } from './repo'
import { gitBinaryBuffer, MIME_BY_EXT, toFileContent } from './util'

import type { FileContent, GitImage } from '@shared/types'

/** File preview slice: working-tree/index/HEAD images, read-only file content and markdown-embedded images. */

/** Max bytes served per markdown image — keeps a huge screenshot from bloating the preview. */
const MARKDOWN_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export async function getImageVersion(file: string, source: 'workdir' | 'index' | 'head'): Promise<GitImage | null> {
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
        // Raw bytes instead of a base64 data URL — the renderer wraps these in a blob URL, so the
        // image never exists as an extra ~1.37x string on both sides of the IPC.
        return { mime, data: buf }
    } catch {
        return null
    }
}

/** Working-tree (or index when staged) content for read-only preview. */
export async function getWorkdirFileContent(file: string, staged: boolean): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        const buf = staged ? await gitBinaryBuffer(p, ['cat-file', '-p', `:${file}`]) : await fs.promises.readFile(path.join(p, file))
        return toFileContent(buf)
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
}

/**
 * Repo-relative image referenced by a markdown preview (`![alt](src)`). Relative sources resolve against the markdown file's directory (a
 * leading `/` anchors at the repo root); remote/inline/escaping sources resolve to null so the renderer leaves them alone. Commit/stash
 * previews read the blob at that revision, otherwise the working tree is read.
 */
export async function getMarkdownImage(
    mdFile: string,
    src: string,
    commitHash?: string | null,
    stashHash?: string | null
): Promise<GitImage | null> {
    const target = resolveMarkdownImagePath(String(mdFile ?? ''), String(src ?? ''))
    if (!target) return null
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
    try {
        let buf: Buffer | null = null
        if (typeof stashHash === 'string' && stashHash) {
            buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${stashHash}:${target}`])
                .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${stashHash}^3:${target}`]))
                .catch(() => null)
        } else if (typeof commitHash === 'string' && commitHash) {
            buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${commitHash}:${target}`]).catch(() => null)
        } else {
            const abs = path.join(p, ...target.split('/'))
            const rel = path.relative(p, abs)
            if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
            buf = await fs.promises.readFile(abs).catch(() => null)
        }
        if (!buf?.length || buf.length > MARKDOWN_IMAGE_MAX_BYTES) return null
        return { mime, data: buf }
    } catch {
        return null
    }
}
