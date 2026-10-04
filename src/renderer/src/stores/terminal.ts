import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useUiStore } from './ui'

import {
    MAX_TERMINALS_PER_REPO,
    canAddTerminal,
    moveTerminalTab,
    terminalTabLabel,
    type TerminalTab,
} from '../utils/terminalTabs'

import type { TerminalShell } from '@shared/types'

/** Terminal tabs of one repo: the shells it owns, which one is on screen, and how the panel sits. */
export interface RepoTerminals {
    tabs: TerminalTab[]
    activeId: string | null
    /** Toggled away from the graph toolbar: the shells keep running, the panel is just not painted. */
    hidden: boolean
    /** True while this repo's panel is the teleported full-height overlay instead of the bottom strip. */
    expanded: boolean
}

export const useTerminalStore = defineStore('terminal', () => {
    /**
     * Terminals per repo path. Memory-only (never persisted): a closed app starts with no terminal
     * anywhere, and shells are killed on repo-tab close, on "kill all" and on app quit. A repo with no
     * entry owns no session and shows no panel — nothing spawns until the user asks for a shell.
     */
    const terminals = ref<Record<string, RepoTerminals>>({})
    /** Monotonic id source — ids are never reused, so a remounted panel finds its live shell again. */
    let terminalSeq = 0
    /** Height (px) of the bottom terminal panel — memory-only UI pref, resets to the default each launch. */
    const terminalHeight = ref(260)

    /** Terminal state of a repo (undefined when it owns no shell). */
    function repoTerminals(path: string): RepoTerminals | undefined {
        return path ? terminals.value[path] : undefined
    }

    /** True when the repo has at least one live shell (its panel stays mounted even while hidden). */
    function terminalExists(path: string): boolean {
        return (repoTerminals(path)?.tabs.length ?? 0) > 0
    }

    /** How many shells a repo holds (for the cap check and the panel header's confirm text). */
    function terminalCount(path: string): number {
        return repoTerminals(path)?.tabs.length ?? 0
    }

    /** True while a repo's panel is on screen (has a shell and isn't toggled away). */
    function panelVisible(path: string): boolean {
        const state = repoTerminals(path)
        return !!state && state.tabs.length > 0 && !state.hidden
    }

    function setRepoTerminals(path: string, state: RepoTerminals | null) {
        if (!path) return
        const next = { ...terminals.value }
        if (state) next[path] = state
        else delete next[path]
        terminals.value = next
    }

    /**
     * Adds a shell tab for a repo (the graph button or the panel `+`). Returns its id, or null once
     * the repo is at the cap. Only records the tab — the mounted panel spawns the pty for that id.
     */
    async function openTerminalTab(path: string): Promise<string | null> {
        const state = repoTerminals(path)
        if (!path || !canAddTerminal(state?.tabs.length ?? 0)) return null
        const ui = useUiStore()
        const shell: TerminalShell = ui.terminalShell
        const shellLabel = await window.api.terminalShell(shell).catch(() => 'shell')
        // Re-read: if the repo's shells were killed while the label was being resolved, there is no
        // panel left to mount the new tab into, so drop it instead of resurrecting a dead entry.
        const current = repoTerminals(path)
        if (state && !current) return null
        const id = `t${++terminalSeq}`
        const tab: TerminalTab = { id, shell, shellLabel, name: null }
        setRepoTerminals(path, {
            tabs: current ? [...current.tabs, tab] : [tab],
            activeId: id,
            hidden: false,
            expanded: false,
        })
        return id
    }

    /** Which of a repo's terminals the panel shows. */
    function setActiveTerminal(path: string, id: string) {
        const state = repoTerminals(path)
        if (!state || state.activeId === id || !state.tabs.some(tab => tab.id === id)) return
        setRepoTerminals(path, { ...state, activeId: id })
    }

    /** Renames one tab (double-click on its label). Blank input falls back to the derived label. */
    function renameTerminalTab(path: string, id: string, name: string) {
        const state = repoTerminals(path)
        if (!state) return
        const tabs = state.tabs.map(tab => (tab.id === id ? { ...tab, name: name.trim() || null } : tab))
        setRepoTerminals(path, { ...state, tabs })
    }

    /** Drag-to-reorder inside one repo. The ids (and therefore the live shells) stay with their tab. */
    function reorderTerminals(path: string, from: number, to: number) {
        const state = repoTerminals(path)
        if (!state) return
        setRepoTerminals(path, { ...state, tabs: moveTerminalTab(state.tabs, from, to) })
    }

    /** Label shown on a terminal tab (custom rename, else "cmd 1"). */
    function tabLabel(path: string, id: string): string {
        const state = repoTerminals(path)
        const index = state?.tabs.findIndex(tab => tab.id === id) ?? -1
        if (!state || index < 0) return ''
        return terminalTabLabel(state.tabs[index], index)
    }

    /**
     * Kills one shell (its tab ✕, or the shell exiting on its own). When the last one goes the repo
     * loses its entry entirely, which unmounts the panel.
     */
    function closeTerminalTab(path: string, id: string) {
        const state = repoTerminals(path)
        const index = state?.tabs.findIndex(tab => tab.id === id) ?? -1
        if (!state || index < 0) return
        void window.api.terminalDispose(id).catch(() => {})
        const tabs = state.tabs.filter(tab => tab.id !== id)
        if (!tabs.length) {
            setRepoTerminals(path, null)
            return
        }
        // Hand focus to the tab that slid into this one's place, else the one before it.
        const activeId = state.activeId === id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId
        setRepoTerminals(path, { ...state, tabs, activeId })
    }

    /**
     * Kills every shell of a repo — its panel ✕, and closing the repo tab itself. Shells of OTHER
     * repos are untouched, which is what keeps a workspace switch (it closes git instances of the
     * repos it leaves) from killing shells the user still wants.
     */
    async function closeRepoTerminals(path: string): Promise<void> {
        if (!terminalExists(path)) return
        await window.api.terminalDisposeRepo(path).catch(() => {})
        setRepoTerminals(path, null)
    }

    /** Show the panel again without touching the shells. */
    function showTerminals(path: string) {
        const state = repoTerminals(path)
        if (!state || !state.hidden) return
        setRepoTerminals(path, { ...state, hidden: false })
    }

    /** Hide the panel — the shells keep running (and keep their scrollback) until a ✕ kills them. */
    function hideTerminals(path: string) {
        const state = repoTerminals(path)
        if (!state || state.hidden) return
        setRepoTerminals(path, { ...state, hidden: true, expanded: false })
    }

    /** Expands the panel to the full-height overlay or back to the bottom strip. */
    function setExpanded(path: string, expanded: boolean) {
        const state = repoTerminals(path)
        if (!state || !panelVisible(path)) return
        setRepoTerminals(path, { ...state, expanded })
    }

    /** True when this repo's panel is the teleported overlay (only the active one ever is). */
    function isExpanded(path: string): boolean {
        const state = repoTerminals(path)
        return !!state && state.expanded && !state.hidden
    }

    /** Kills every shell of every repo — the header button, the palette command and its shortcut. */
    async function killAllTerminals(): Promise<number> {
        const total = Object.values(terminals.value).reduce((sum, state) => sum + state.tabs.length, 0)
        await window.api.terminalDisposeAll().catch(() => 0)
        terminals.value = {}
        return total
    }

    /** Cap for the panel `+` button — kept here so the header and the palette share one source. */
    const maxPerRepo = computed(() => MAX_TERMINALS_PER_REPO)

    return {
        terminals,
        terminalHeight,
        maxPerRepo,
        repoTerminals,
        terminalExists,
        terminalCount,
        panelVisible,
        openTerminalTab,
        setActiveTerminal,
        renameTerminalTab,
        reorderTerminals,
        tabLabel,
        closeTerminalTab,
        closeRepoTerminals,
        showTerminals,
        hideTerminals,
        setExpanded,
        isExpanded,
        killAllTerminals,
    }
})

export { MAX_TERMINALS_PER_REPO }
export type { TerminalTab }
