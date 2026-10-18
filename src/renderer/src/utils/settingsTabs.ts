/** Tools-modal tab keys — the repo store's `toolsTab`, the modal's `initialTab` and the palette's Settings rows all speak this. */
export type SettingsTabKey = 'appearance' | 'general' | 'auth' | 'ai' | 'terminal' | 'shortcuts'

/**
 * Tools-modal tabs in strip order. Labels match the modal's tab strip (`auth` shows as “Remotes”), so the command palette's query-driven
 * Settings section reads exactly like the strip itself.
 */
export const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
    { key: 'appearance', label: 'Appearance' },
    { key: 'general', label: 'General' },
    { key: 'auth', label: 'Remotes' },
    { key: 'ai', label: 'AI' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'shortcuts', label: 'Shortcuts' },
]
