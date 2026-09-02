/** Single source of truth for keyboard shortcuts — used by the global keydown handler and the ShortcutsModal. */

export const isMac = /mac/i.test(navigator.platform)

export interface ShortcutDef {
    id: string
    label: string
    mac: string[]
    win: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
    { id: 'pull', label: 'Pull', mac: ['Ctrl+L', 'Cmd+↓'], win: ['Ctrl+L', 'Alt+↓'] },
    { id: 'push', label: 'Push', mac: ['Ctrl+P', 'Cmd+↑'], win: ['Ctrl+P', 'Alt+↑'] },
    { id: 'fetch', label: 'Fetch', mac: ['Ctrl+F'], win: ['Ctrl+F'] },
    { id: 'openRepo', label: 'Open repo', mac: ['Ctrl+O'], win: ['Ctrl+O'] },
    { id: 'settings', label: 'Open settings', mac: ['Ctrl+,'], win: ['Ctrl+,'] },
    { id: 'refresh', label: 'Refresh repository', mac: ['Cmd+R'], win: ['Ctrl+R'] },
    { id: 'search', label: 'Search commits', mac: ['Cmd+Shift+F'], win: ['Ctrl+Shift+F'] },
    { id: 'newRepo', label: 'Open new tab', mac: ['Cmd+Shift+P'], win: ['Ctrl+Shift+P'] },
    { id: 'shortcuts', label: 'Show shortcuts', mac: ['?'], win: ['?'] },
]

/** Key combos for a shortcut id, formatted for the current platform. */
export function keysFor(id: string): string[] {
    const def = SHORTCUTS.find(s => s.id === id)
    if (!def) return []
    return isMac ? def.mac : def.win
}
