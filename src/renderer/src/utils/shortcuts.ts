/** Single source of truth for keyboard shortcuts — used by the global keydown handler and the ShortcutsModal. */

export const isMac = /mac/i.test(navigator.platform)

export interface ShortcutDef {
    id: string
    label: string
    mac: string[]
    win: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
    { id: 'fetch', label: 'Fetch', mac: ['Ctrl+Shift+↓'], win: ['Ctrl+Shift+↓'] },
    { id: 'pull', label: 'Pull', mac: ['Ctrl+↓'], win: ['Ctrl+↓'] },
    { id: 'push', label: 'Push', mac: ['Ctrl+↑'], win: ['Ctrl+↑'] },
    { id: 'openRepo', label: 'Open repo', mac: ['Ctrl+O'], win: ['Ctrl+O'] },
    { id: 'searchCommits', label: 'Search commits', mac: ['⌘F'], win: ['Ctrl+F'] },
    { id: 'settings', label: 'Open settings', mac: ['Ctrl+,'], win: ['Ctrl+,'] },
    { id: 'commandPalette', label: 'Command palette', mac: ['Ctrl+P', 'Shift+Shift'], win: ['Ctrl+P', 'Shift+Shift'] },
    { id: 'shortcuts', label: 'Show shortcuts', mac: ['?'], win: ['?'] },
]

export type SyncShortcutId = 'push' | 'pull' | 'fetch'

/** Fixed defaults — the Default button in settings always restores these. */
export const SYNC_SHORTCUT_DEFAULTS: Record<SyncShortcutId, string> = {
    push: 'Ctrl+ArrowUp',
    pull: 'Ctrl+ArrowDown',
    fetch: 'Ctrl+Shift+ArrowDown',
}

export const SYNC_SHORTCUT_IDS: SyncShortcutId[] = ['fetch', 'pull', 'push']

/** Shortcuts customizable in Settings → Shortcuts. '?' and zoom stay fixed. */
export type CustomShortcutId = SyncShortcutId | 'openRepo' | 'searchCommits' | 'settings' | 'commandPalette'

export const CUSTOM_SHORTCUT_IDS: CustomShortcutId[] = [
    'fetch',
    'pull',
    'push',
    'openRepo',
    'searchCommits',
    'settings',
    'commandPalette',
]

/** Platform a custom shortcut override applies to. Combos stay canonical ("Ctrl+…", Cmd counts as Ctrl) — only the stored value differs per platform. */
export type ShortcutPlatform = 'mac' | 'win'

export const SHORTCUT_PLATFORMS: ShortcutPlatform[] = ['mac', 'win']

/** Per-platform overrides for one shortcut id. Absent platform = use SHORTCUT_DEFAULTS. */
export type ShortcutOverrideEntry = Partial<Record<ShortcutPlatform, string>>

/** Persisted custom shortcuts. Empty = use SHORTCUT_DEFAULTS everywhere. */
export type ShortcutOverrideMap = Partial<Record<CustomShortcutId, ShortcutOverrideEntry>>

/** Platform of the current runtime. */
export function currentPlatform(): ShortcutPlatform {
    return isMac ? 'mac' : 'win'
}

/** Effective defaults for every customizable shortcut. */
export const SHORTCUT_DEFAULTS: Record<CustomShortcutId, string> = {
    ...SYNC_SHORTCUT_DEFAULTS,
    openRepo: 'Ctrl+O',
    searchCommits: 'Ctrl+F',
    settings: 'Ctrl+,',
    commandPalette: 'Ctrl+P',
}

/** Fixed combos a custom shortcut must not override (app zoom — handled above the busy gate). */
const RESERVED_COMBOS = new Set(['Ctrl+=', 'Ctrl+-', 'Ctrl+0'])

/** Normalize a KeyboardEvent to a canonical combo ("Ctrl+Shift+ArrowDown"). Cmd counts as Ctrl. */
export function eventToCombo(event: KeyboardEvent): string | null {
    if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') return null
    const parts: string[] = []
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
    if (event.shiftKey) parts.push('Shift')
    if (event.altKey) parts.push('Alt')
    let key = event.key
    if (key === ' ') key = 'Space'
    else if (key.length === 1) key = key.toUpperCase()
    parts.push(key)
    if (parts.length < 2) return null
    return parts.join('+')
}

/** "Ctrl+ArrowUp" → "Ctrl+↑" for display. */
export function formatCombo(combo: string): string {
    return combo
        .replaceAll('ArrowUp', '↑')
        .replaceAll('ArrowDown', '↓')
        .replaceAll('ArrowLeft', '←')
        .replaceAll('ArrowRight', '→')
}

/** Canonical combo → macOS display ("Ctrl+Shift+ArrowDown" → "⌘+Shift+↓"). */
export function formatComboMac(combo: string): string {
    return formatCombo(combo).replaceAll('Ctrl', '⌘')
}

/** A valid custom sync combo requires Ctrl (or Cmd) plus a main key. */
export function isValidSyncCombo(combo: string): boolean {
    const parts = combo.split('+')
    if (parts.length < 2 || parts[0] !== 'Ctrl') return false
    const main = parts[parts.length - 1]!
    return main !== 'Ctrl' && main !== 'Shift' && main !== 'Alt' && main !== 'Meta' && main.length > 0
}

/** True when the combo is taken by a fixed shortcut or another customizable id (pass effective values). */
export function isReservedCombo(combo: string, effective: Partial<Record<string, string>>, except?: string): boolean {
    if (RESERVED_COMBOS.has(combo)) return true
    for (const [id, value] of Object.entries(effective)) {
        if (id !== except && value === combo) return true
    }
    return false
}

/** Key combos for a shortcut id, formatted for the current platform. */
export function keysFor(id: string): string[] {
    const def = SHORTCUTS.find(s => s.id === id)
    if (!def) return []
    return isMac ? def.mac : def.win
}
