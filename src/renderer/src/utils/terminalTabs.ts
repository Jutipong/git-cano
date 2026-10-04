import type { TerminalShell } from '@shared/types'

/** Shells a single repo may hold at once (the terminal panel's `+` button stops here). */
export const MAX_TERMINALS_PER_REPO = 4

export interface TerminalTab {
    /** Stable id — also the pty key in the main process. */
    id: string
    /** Shell this tab was spawned with, used when the tab has no custom name. */
    shell: TerminalShell
    /** Short shell label ("cmd") resolved by the main process, never shown raw. */
    shellLabel: string
    /** User-set tab name (double-click rename). Empty/null = derive from shell + position. */
    name: string | null
}

/**
 * Tab label: the user's rename wins, otherwise the shell name plus the tab's 1-based position in the
 * repo (cmd 1, powershell 2, cmd 3). Reordering shifts the derived numbers, like repo tabs.
 */
export function terminalTabLabel(tab: TerminalTab, index: number): string {
    const custom = tab.name?.trim()
    return custom || `${tab.shellLabel} ${index + 1}`
}

/** True when the repo can take one more shell. */
export function canAddTerminal(count: number): boolean {
    return count < MAX_TERMINALS_PER_REPO
}

/**
 * Moves one tab inside its list (drag-to-reorder). Bounds-guarded like the workspace reorder, so a
 * stale drag target is ignored instead of corrupting the list.
 */
export function moveTerminalTab<T>(tabs: T[], from: number, to: number): T[] {
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return tabs
    const next = [...tabs]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
}
