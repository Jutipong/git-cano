/** Pure helpers for the clone flow — shared by the renderer preview and the main process. */

/** Characters Windows refuses inside a single path segment. */
// eslint-disable-next-line no-control-regex
const INVALID_SEGMENT_CHARS = /[<>:"/|?*\x00-\x1f]/

/**
 * Guess the default folder name from a repository URL.
 * Handles https/ssh URLs, scp-like `git@host:user/repo.git`, trailing slashes,
 * and query/fragment suffixes. Strips a trailing `.git` (case-insensitive).
 */
export function extractRepoFolderName(url: string): string {
    let text = url.trim()
    if (!text) return ''
    const cut = text.search(/[?#]/)
    if (cut >= 0) text = text.slice(0, cut)
    text = text.replace(/[/\\]+$/, '')
    if (!text) return ''
    let segment = text.slice(text.lastIndexOf('/') + 1)
    // scp-like without a slash after the colon, e.g. `git@github.com:repo.git`
    const colon = segment.lastIndexOf(':')
    if (colon >= 0) segment = segment.slice(colon + 1)
    segment = segment.replace(/[/\\]+$/, '').trim()
    if (!segment || segment === '.' || segment === '..') return ''
    return segment.replace(/\.git$/i, '')
}

/** Trimmed folder input with trailing slashes removed. */
export function sanitizeCloneFolderName(name: string): string {
    return name.trim().replace(/[/\\]+$/, '')
}

/**
 * A clone folder must be a single segment: non-empty, no slashes, no traversal,
 * no Windows-forbidden characters, and not ending with a dot/space.
 */
export function isValidCloneFolderName(name: string): boolean {
    const clean = sanitizeCloneFolderName(name)
    if (!clean) return false
    if (clean === '.' || clean === '..') return false
    if (clean.includes('/') || clean.includes('\\')) return false
    if (clean === '..' || /(^|[\\/])\.\.([\\/]|$)/.test(clean)) return false
    if (INVALID_SEGMENT_CHARS.test(clean)) return false
    if (/[. ]$/.test(clean)) return false
    return true
}

export function cloneFolderError(name: string): string {
    const clean = sanitizeCloneFolderName(name)
    if (!clean) return 'Folder name is required'
    if (clean === '.' || clean === '..') return 'Folder name is reserved'
    if (clean.includes('/') || clean.includes('\\')) return 'Folder name must be a single folder (no slashes)'
    if (/(^|[\\/])\.\.([\\/]|$)/.test(clean)) return 'Folder name must not contain ..'
    if (INVALID_SEGMENT_CHARS.test(clean)) return 'Folder name contains an invalid character (< > : " / \\ | ? *)'
    if (/[. ]$/.test(clean)) return 'Folder name must not end with a dot or space'
    return ''
}

/** Join parent + folder for the preview line (display only — main uses path.join). */
export function joinClonePath(parent: string, folder: string): string {
    const p = parent.trim().replace(/[/\\]+$/, '')
    const f = sanitizeCloneFolderName(folder)
    if (!p) return f
    if (!f) return p
    return `${p}${p.includes('\\') ? '\\' : '/'}${f}`
}
