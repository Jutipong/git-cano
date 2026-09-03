/** Single source of truth for keyboard shortcuts — used by the global keydown handler and the ShortcutsModal. */

export const isMac = /mac/i.test(navigator.platform)

export interface ShortcutDef {
    id: string
    label: string
    mac: string[]
    win: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
    { id: 'commandPalette', label: 'Command palette', mac: ['Ctrl+P', 'Shift+Shift'], win: ['Ctrl+P', 'Shift+Shift'] },
    { id: 'openRepo', label: 'Open repo', mac: ['Ctrl+O'], win: ['Ctrl+O'] },
    { id: 'settings', label: 'Open settings', mac: ['Ctrl+,'], win: ['Ctrl+,'] },
    { id: 'shortcuts', label: 'Show shortcuts', mac: ['?'], win: ['?'] },
]

/** Key combos for a shortcut id, formatted for the current platform. */
export function keysFor(id: string): string[] {
    const def = SHORTCUTS.find(s => s.id === id)
    if (!def) return []
    return isMac ? def.mac : def.win
}
