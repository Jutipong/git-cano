/**
 * Link gating for the terminal panel. Plain-text URLs arrive from `@xterm/addon-web-links` and
 * OSC 8 hyperlinks from xterm's built-in provider — both must route through `app:openExternal`
 * (the OS browser), never `window.open` (which would spawn an Electron window instead).
 */

/** http(s) only — mirrors the `app:openExternal` guard in `main/index.ts`. */
export function isOpenableTerminalLink(uri: string): boolean {
    return /^https?:\/\//i.test(uri.trim())
}

/**
 * Ctrl/Cmd+click is the terminal convention (Windows Terminal, VS Code); a plain click stays a
 * selection, so drag-selecting or double-clicking a URL never launches the browser by accident.
 */
export function shouldActivateTerminalLink(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>, uri: string): boolean {
    return (event.ctrlKey || event.metaKey) && isOpenableTerminalLink(uri)
}
