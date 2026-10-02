/** Read-only file preview supports rendered markdown and pretty-printed JSON. Single source of
 *  truth for both the file context menu and the DiffView header button. */
export function isPreviewablePath(path: string): boolean {
    const lower = path.toLowerCase()
    return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdown') || lower.endsWith('.json')
}
