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
    /** Per-shell instance number, bound when the tab is created — see `nextTerminalNumber`. */
    number: number
    /** User-set tab name (double-click rename). Empty/null = derive from shell + number. */
    name: string | null
}

/**
 * Tab label: the user's rename wins, otherwise the shell name plus the tab's own number (cmd 1,
 * cmd 2). The number belongs to the tab, not to its slot — dragging a tab around, or closing its
 * neighbour, never renames a live shell.
 */
export function terminalTabLabel(tab: TerminalTab): string {
    const custom = tab.name?.trim()
    return custom || `${tab.shellLabel} ${tab.number}`
}

/**
 * Number for a new tab: one past the highest its own shell already uses, so a live tab never
 * changes label and the next shell of the same kind always lands on a fresh number.
 */
export function nextTerminalNumber(tabs: TerminalTab[], shell: TerminalShell): number {
    let highest = 0
    for (const tab of tabs) if (tab.shell === shell && tab.number > highest) highest = tab.number
    return highest + 1
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
