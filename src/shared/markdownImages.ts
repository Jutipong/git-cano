/**
 * Markdown image source helpers — shared by the main-process resolver and the
 * preview renderer so both agree on what counts as a repo-relative image.
 *
 * `marked` emits `<img src="...">` verbatim, so a relative source like
 * `docs/screenshots/01-overview.png` would resolve against the app URL instead
 * of the repository. The preview rewrites those through the `markdown:image`
 * IPC; remote (`http(s)`) and inline (`data:`/`blob:`) sources are left alone
 * for the browser (gated by the renderer's `img-src` CSP).
 */

/** True when the browser can load the source itself — no IPC rewrite needed. */
export function isLoadableMarkdownImageSrc(src: string): boolean {
    const trimmed = src.trim()
    if (!trimmed) return false
    if (/^(data|blob):/i.test(trimmed)) return true
    if (/^https?:\/\//i.test(trimmed)) return true
    if (trimmed.startsWith('//')) return true
    return false
}

/**
 * Resolve a markdown `<img src>` to a repo-relative posix path (`a/b.png`).
 * Returns null for remote/inline sources, absolute URLs, and anything that
 * would escape the repository root.
 */
export function resolveMarkdownImagePath(mdFile: string, src: string): string | null {
    const trimmed = src.trim()
    if (!trimmed || trimmed.startsWith('#')) return null
    if (/^(data|blob):/i.test(trimmed)) return null
    if (trimmed.startsWith('//')) return null
    // Any other scheme (`http:`, `https:`, `file:`, `ftp:`…) stays with the browser.
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
    if (trimmed.includes('\0')) return null

    // Drop any `?query` / `#fragment` — they never address a different blob.
    const withoutSuffix = trimmed.split(/[?#]/)[0].trim()
    if (!withoutSuffix) return null

    let decoded = withoutSuffix
    try {
        decoded = decodeURIComponent(withoutSuffix)
    } catch {
        decoded = withoutSuffix
    }
    if (!decoded || decoded.includes('\0')) return null
    // Absolute Windows paths and backslash escapes can never be repo blobs.
    if (/^[a-z]:/i.test(decoded) || decoded.includes('\\')) return null

    const baseDir = mdFile.includes('/') ? mdFile.slice(0, mdFile.lastIndexOf('/')) : ''
    const joined = decoded.startsWith('/') ? decoded.slice(1) : baseDir ? `${baseDir}/${decoded}` : decoded

    const parts = joined.split('/')
    const stack: string[] = []
    for (const part of parts) {
        if (!part || part === '.') continue
        if (part === '..') {
            if (!stack.length) return null
            stack.pop()
        } else {
            stack.push(part)
        }
    }
    if (!stack.length) return null
    return stack.join('/')
}
