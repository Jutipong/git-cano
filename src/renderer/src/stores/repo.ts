import { assignLanes } from '@shared/lanes'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useUiTransientStore } from './uiTransient'
import { useWorkspaceStore } from './workspace'

import type { BranchInfo, CommitFile, CommitNode, RepoState, RepoStatus, StashEntry } from '@shared/types'

const PAGE_SIZE = 500

/** Shells a single repo may hold at once (the terminal panel's `+` button stops here). */
export const MAX_TERMINALS_PER_REPO = 4

export interface RepoTab {
    path: string
    name: string
    status: RepoStatus
}

interface PersistedSession {
    paths: string[]
    active: number
}

const SESSION_STORAGE_KEY = 'repo'
const LEGACY_SESSION_STORAGE_KEY = 'ogit-session'

function isPersistedSession(value: unknown): value is PersistedSession {
    if (!value || typeof value !== 'object') return false
    const candidate = value as { paths?: unknown; active?: unknown }
    return (
        Array.isArray(candidate.paths) &&
        candidate.paths.every(path => typeof path === 'string' && path.length > 0) &&
        Number.isInteger(candidate.active) &&
        (candidate.active as number) >= 0
    )
}

function parsePersistedSession(raw: string | null, wrapped: boolean): PersistedSession | null {
    if (!raw) return null
    try {
        const parsed: unknown = JSON.parse(raw)
        const value =
            wrapped && parsed && typeof parsed === 'object' && 'session' in parsed ? (parsed as { session?: unknown }).session : parsed
        return isPersistedSession(value) ? value : null
    } catch {
        return null
    }
}

function loadSavedSession(): { session: PersistedSession; fromLegacy: boolean } {
    try {
        const current = parsePersistedSession(localStorage.getItem(SESSION_STORAGE_KEY), true)
        if (current) return { session: current, fromLegacy: false }

        const legacy = parsePersistedSession(localStorage.getItem(LEGACY_SESSION_STORAGE_KEY), false)
        if (legacy) return { session: legacy, fromLegacy: true }
    } catch {}
    return { session: { paths: [], active: 0 }, fromLegacy: false }
}

export const useRepoStore = defineStore('repo', () => {
    const tabs = ref<RepoTab[]>([])
    const activeTab = ref(0)
    const commits = ref<CommitNode[]>([])
    /** Latest branch list for the active repo — kept here so the sidebar doesn't spawn a second branch fetch per refresh. */
    const branchList = ref<{ local: BranchInfo[]; remote: BranchInfo[] } | null>(null)
    /** Latest tag data for the active repo — fetched alongside branches in refresh() so the sidebar reads from the store. */
    const tagList = ref<{ name: string; hash: string }[]>([])
    const loadingTags = ref(false)
    const remoteTagNames = ref<string[]>([])
    const hasRemote = ref(false)
    const logLimit = ref(PAGE_SIZE)
    const hasMore = ref(false)
    const selectedFile = ref<{ path: string; staged: boolean } | null>(null)
    /** Conflicted file opened in ConflictView — mutually exclusive with selectedFile. */
    const selectedConflict = ref<{ path: string } | null>(null)
    const selectedCommit = ref<CommitNode | null>(null)
    const selectedStash = ref<StashEntry | null>(null)
    const booted = ref(false)
    const switchingWorkspace = ref(false)
    /** Path of the repo whose status/commits are actually loaded — used to detect a mid-switch tab. */
    const loadedPath = ref<string | null>(null)
    const commitFiles = ref<CommitFile[]>([])
    const loadingCommitDetails = ref(false)
    /** True while a repo-switch-driven refresh is in flight — drives the small graph spinner (cache is painted underneath). */
    const refreshingRepo = ref(false)
    const commitMessage = ref('')
    const commitAuthor = ref('')
    const commitDate = ref('')
    const stashFiles = ref<CommitFile[]>([])
    const repoState = ref<RepoState>({ merging: false, rebasing: false, cherryPicking: false })
    const loadedSession = loadSavedSession()
    const session = ref<PersistedSession>(loadedSession.session)
    let legacyMigrationPending = loadedSession.fromLegacy

    const ws = useWorkspaceStore()
    // migrate the legacy single session (localStorage 'repo') into the current workspace once
    if (!ws.getSession(ws.active) && session.value.paths.length) {
        ws.setSession(ws.active, { paths: [...session.value.paths], active: session.value.active })
    }

    const rebaseBase = ref<string | null>(null)
    const historyFile = ref<string | null>(null)
    const blameFile = ref<string | null>(null)
    /** Read-only preview (markdown / JSON) — path only, revision comes from selected commit/stash. */
    const previewFile = ref<string | null>(null)
    const toolsOpen = ref(false)
    /** Whether the reflog recovery viewer is open. */
    const reflogOpen = ref(false)
    /** Whether the keyboard-shortcuts help modal is open. */
    const shortcutsOpen = ref(false)
    /** Whether the command palette overlay is open. */
    const commandPaletteOpen = ref(false)
    /** Which tab the tools modal should show when it opens (e.g. 'ai' from the AI commit dropdown). */
    const toolsTab = ref<'appearance' | 'general' | 'shortcuts' | 'auth' | 'ai' | 'terminal'>('appearance')

    const pendingFocusHash = ref<string | null>(null)
    /** Branch soloed in the graph (GitKraken-style focus) — view-only filter, never persisted. */
    const soloBranch = ref<string | null>(null)
    /** Files touched by the soloed branch's visible commits (Focus dimming) — null when not soloed. */
    const soloFiles = ref<string[] | null>(null)
    /** Terminal tabs of one repo: the shells it owns, which one is on screen, and whether the panel is hidden. */
    interface RepoTerminals {
        /** Terminal ids in tab order — an unnamed tab's label is its 1-based index here. */
        ids: string[]
        activeId: string | null
        /** Toggled away from the graph toolbar: the shells keep running, the panel is just not painted. */
        hidden: boolean
        /** Custom tab labels by terminal id (right-click → Rename). Memory-only, like the shells. */
        names: Record<string, string>
        /** Creation-time tab numbers by terminal id — the "<n> <shell>" label never moves on reorder. */
        numbers: Record<string, number>
    }

    /**
     * Terminals per repo path. Memory-only (never persisted): a closed app starts with no terminal
     * anywhere, and every pty is killed on tab close / app quit. A workspace switch keeps shells
     * alive (the repo is parked — see `closeParkedRepo`). A repo with no entry has no panel at all.
     */
    const terminals = ref<Record<string, RepoTerminals>>({})
    /** Monotonic id source — ids are never reused, so a remounted panel finds its live shell again. */
    let terminalSeq = 0
    /** Height (px) of the bottom terminal panel — memory-only UI pref, resets to the default each launch. */
    const TERMINAL_DEFAULT_HEIGHT = 260
    const terminalHeight = ref(TERMINAL_DEFAULT_HEIGHT)
    /**
     * True while the terminal is expanded to fill the center column (graph hidden). Memory-only,
     * per active view — reset on tab switch and whenever the panel is closed or hidden.
     */
    const terminalExpanded = ref(false)
    let tagLoadingRequests = 0
    let remoteTagRequest = 0
    const loadingRemoteTags = ref(false)

    async function loadTags(): Promise<{ name: string; hash: string }[]> {
        tagLoadingRequests++
        loadingTags.value = true
        try {
            return await window.api.tags()
        } finally {
            tagLoadingRequests--
            loadingTags.value = tagLoadingRequests > 0
        }
    }

    async function loadRemoteTags(targetPath: string): Promise<void> {
        const request = ++remoteTagRequest
        loadingRemoteTags.value = true
        try {
            const names = await window.api.remoteTags()
            if (request === remoteTagRequest && tabs.value[activeTab.value]?.path === targetPath) {
                remoteTagNames.value = names
            }
        } catch {
            if (request === remoteTagRequest && tabs.value[activeTab.value]?.path === targetPath) {
                remoteTagNames.value = []
            }
        } finally {
            if (request === remoteTagRequest) loadingRemoteTags.value = false
        }
    }

    const repo = computed<RepoStatus | null>(() => tabs.value[activeTab.value]?.status ?? null)
    /** True while the active tab still shows another repo's data (switch/new tab not refreshed yet). */
    const loadingRepo = computed(() => {
        const tab = tabs.value[activeTab.value]
        return !!tab && loadedPath.value !== tab.path
    })
    const conflicts = computed(() => repo.value?.files.filter(f => f.staged === 'U' || f.unstaged === 'U').map(f => f.path) ?? [])

    /** Labels for the two sides of a conflict (shared by FilePanel and ConflictView). */
    const oursLabel = computed(() =>
        repoState.value.merging || repoState.value.cherryPicking || repoState.value.rebasing ? repo.value?.branch || 'current' : 'ours'
    )
    const theirsLabel = computed(() => {
        if (repoState.value.merging) return repoState.value.mergeSource || 'incoming'
        if (repoState.value.cherryPicking) return repoState.value.cherryPickSource || 'incoming'
        return 'theirs'
    })

    // ConflictView closes itself once its file no longer reports unmerged (resolved elsewhere or saved)
    watch(conflicts, list => {
        if (selectedConflict.value && !list.includes(selectedConflict.value.path)) selectedConflict.value = null
    })

    let restoringSession = false

    function syncSession() {
        if (restoringSession) return
        session.value = { paths: tabs.value.map(tab => tab.path), active: activeTab.value }
        ws.setSession(ws.active, { paths: [...session.value.paths], active: session.value.active })
        try {
            if (legacyMigrationPending) {
                localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY)
                legacyMigrationPending = false
            }
        } catch {}
    }

    function addTab(status: RepoStatus) {
        void window.api.recentAdd(status.path).catch(() => {})
        const existingIndex = tabs.value.findIndex(tab => tab.path === status.path)
        if (existingIndex >= 0) {
            tabs.value[existingIndex].status = status
            activeTab.value = existingIndex
            syncSession()
            return
        }
        tabs.value.push({ path: status.path, name: status.name, status })
        activeTab.value = tabs.value.length - 1
        // Solo is per-repo view state — a newly opened repo always starts with the full graph,
        // even if it happens to have a branch with the same name as the previous solo.
        soloBranch.value = null
        syncSession()
        // The status is fresh but the graph still holds the previous repo's data — load it.
        // The just-computed status is passed through so refresh() doesn't spawn git status again
        // (skipped while restoring a workspace/init: selectTab refreshes exactly once at the end).
        if (!restoringSession) {
            void window.api
                .setActiveRepo(status.path)
                .then(() => refresh(status, true))
                .catch(() => {})
        }
    }

    async function refresh(precomputedStatus?: RepoStatus, switching = false, withTags = false) {
        const targetPath = tabs.value[activeTab.value]?.path
        // Tag reload is opt-in: tab switches always need fresh tags (single active list),
        // other callers pass withTags only when the action actually touches tags.
        const needTags = switching || withTags
        if (switching) {
            refreshingRepo.value = true
            loadingTags.value = true
            remoteTagRequest++
            loadingRemoteTags.value = false
            // tags have no cached paint (unlike branches) — clear them so the sidebar never shows the previous repo's tags
            tagList.value = []
            remoteTagNames.value = []
            hasRemote.value = false
        }
        try {
            // preserve scroll depth: if more pages were appended via loadMore, refetch the full depth
            const limit = Math.max(logLimit.value, commits.value.length)
            const solo = soloBranch.value
            const logPromise = (async () => {
                if (!solo) return window.api.log(limit)
                try {
                    return await window.api.logSolo(solo, limit)
                } catch {
                    // branch is gone (deleted upstream) — fall back to the full graph
                    soloBranch.value = null
                    return window.api.log(limit)
                }
            })()
            const tagsPromise = needTags ? loadTags() : Promise.resolve(null)
            const [status, log, branches, state, tags, remote, focused] = await Promise.all([
                precomputedStatus ? Promise.resolve(precomputedStatus) : window.api.status(),
                logPromise,
                window.api.branches(),
                window.api.repoState(),
                tagsPromise,
                window.api.hasRemote(),
                solo ? window.api.soloFiles(solo, limit).catch(() => [] as string[]) : Promise.resolve(null),
            ])
            if (!tabs.value.some(tab => tab.path === status.path)) return
            if (tabs.value[activeTab.value]?.path !== status.path) return
            commits.value = log
            // A second solo may have started mid-flight — only apply files for the current one.
            if (soloBranch.value === solo) soloFiles.value = focused
            hasMore.value = log.length >= limit
            repoState.value = state
            branchList.value = branches
            if (needTags && tags) tagList.value = tags
            hasRemote.value = remote
            loadedPath.value = status.path
            const index = tabs.value.findIndex(tab => tab.path === status.path)
            if (index >= 0) tabs.value[index].status = status
            // Remote tag lookup is network-bound; do not hold repository switching on it.
            if (needTags) void loadRemoteTags(status.path)
            return branches
        } catch (error) {
            // clear the loading overlay even on failure — the error dialog surfaces the problem
            if (targetPath && tabs.value[activeTab.value]?.path === targetPath) loadedPath.value = targetPath
            useUiTransientStore().notify(String(error))
            return undefined
        } finally {
            if (switching) refreshingRepo.value = false
        }
    }

    /**
     * Full refresh that also reloads local + remote tags (fetch/pull/tag mutations/tab switches).
     * Plain refresh() skips tags on purpose — most actions never touch them.
     */
    function refreshWithTags(precomputedStatus?: RepoStatus) {
        return refresh(precomputedStatus, false, true)
    }

    /**
     * Light refresh for frequent events (window focus): 1 git spawn instead of 4. Escalates to a full refresh only when the status actually
     * changed. NOT used for repo-changed watcher events — those always mean real git activity, so they keep using the full refresh().
     */
    async function refreshStatusOnly() {
        if (useUiTransientStore().busy || switchingWorkspace.value) return
        const tab = tabs.value[activeTab.value]
        if (!tab || loadedPath.value !== tab.path) return
        try {
            const status = await window.api.status()
            if (tabs.value[activeTab.value]?.path !== status.path) return
            const prev = tabs.value[activeTab.value]?.status
            if (!prev) {
                tabs.value[activeTab.value].status = status
                return
            }
            // only swap the status object (and escalate) on a real change — an unconditional swap
            // would retrigger the sidebar's repo watcher on every focus, refetching tags for nothing
            if (statusSignature(prev) !== statusSignature(status)) {
                tabs.value[activeTab.value].status = status
                await refresh(status)
            }
        } catch {}
    }

    /** Cheap change detector — avoids a full refresh when focus found nothing new. */
    function statusSignature(s: RepoStatus): string {
        return `${s.branch}|${s.ahead}|${s.behind}|${s.files.map(f => `${f.path}${f.staged}${f.unstaged}`).join(',')}`
    }

    async function selectTab(index: number, precomputedStatus?: RepoStatus) {
        if (useUiTransientStore().busy) return
        const tab = tabs.value[index]
        if (!tab) return
        activeTab.value = index
        selectedFile.value = null
        selectedConflict.value = null
        selectedCommit.value = null
        selectedStash.value = null
        soloBranch.value = null
        // Expanded intentionally survives a tab switch (multi-repo workflows keep the big terminal):
        // the terminalVisible watcher collapses it only when the target repo's panel isn't on screen.
        syncSession()
        await window.api.setActiveRepo(tab.path).catch(() => {})
        // Stale-while-revalidate: paint the cached log and branch list for this repo instantly
        // (no git spawn), then refresh() over it with fresh data.
        if (loadedPath.value !== tab.path) {
            loadingTags.value = true
            tagList.value = []
            remoteTagNames.value = []
            hasRemote.value = false
            const [cachedLog, cachedBranches] = await Promise.all([
                window.api.logCached(logLimit.value).catch(() => null),
                window.api.branchesCached().catch(() => null),
            ])
            if (cachedBranches) branchList.value = cachedBranches
            if (cachedLog && tabs.value[activeTab.value]?.path === tab.path) {
                commits.value = cachedLog
                hasMore.value = cachedLog.length >= logLimit.value
                loadedPath.value = tab.path
            }
        }
        await refresh(precomputedStatus, true)
    }

    async function closeTab(index: number) {
        if (useUiTransientStore().busy) return
        const tab = tabs.value[index]
        if (!tab) return
        const wasActive = index === activeTab.value
        const stillOpen = await window.api.closeRepo(tab.path).catch(() => false)
        const remaining = tabs.value.filter((_, i) => i !== index)
        // Every pty of the repo is killed by the main process on repo:close; drop the renderer state too.
        forgetRepoTerminals(tab.path)
        tabs.value = remaining
        activeTab.value = Math.max(0, activeTab.value > index ? activeTab.value - 1 : Math.min(activeTab.value, remaining.length - 1))
        if (!stillOpen) {
            commits.value = []
            selectedCommit.value = null
            selectedStash.value = null
            soloBranch.value = null
        }
        syncSession()
        if (wasActive && remaining.length > 0) {
            await selectTab(activeTab.value)
        }
    }

    async function setActive(index: number) {
        if (useUiTransientStore().busy) return
        activeTab.value = index
        await selectTab(index)
    }

    function reorderTabs(from: number, to: number) {
        if (from === to || from < 0 || to < 0 || from >= tabs.value.length || to >= tabs.value.length) return
        const [moved] = tabs.value.splice(from, 1)
        tabs.value.splice(to, 0, moved)
        const target = to
        if (activeTab.value === from) {
            activeTab.value = target
        } else if (from < activeTab.value && target >= activeTab.value) {
            activeTab.value--
        } else if (from > activeTab.value && target <= activeTab.value) {
            activeTab.value++
        }
        syncSession()
    }

    async function init() {
        restoringSession = true
        // Terminal state is memory-only, so a booting renderer owns no shells: any live pty in the
        // main process is an orphan from a previous renderer session (reload / crash) — invisible,
        // and it would collide with this session's ids. Clear them before any terminal can open.
        void window.api.terminalDisposeAll().catch(() => {})
        let paths: string[] = []
        try {
            const wsSession = ws.getSession(ws.active)
            const saved = wsSession ?? session.value
            const savedActivePath = saved.paths[saved.active]
            // Respect a deliberately empty workspace session (user closed every repo).
            // The recent-repo fallback is only for a workspace with no saved session at all (first run).
            paths = saved.paths.length
                ? saved.paths
                : wsSession
                  ? []
                  : (await window.api.recentList().catch(() => [] as string[])).slice(0, 1)
            // Open all repos concurrently — each openRepo is independent (per-instance status),
            // and sequential spawning is the dominant cost on Windows.
            const statuses = await Promise.all(paths.map(path => window.api.openPath(path).catch(() => null)))
            for (const status of statuses) {
                if (status) addTab(status)
            }
            const restoredActive = savedActivePath ? tabs.value.findIndex(tab => tab.path === savedActivePath) : -1
            if (restoredActive >= 0) {
                activeTab.value = restoredActive
                await selectTab(restoredActive, tabs.value[restoredActive]?.status)
            } else if (tabs.value.length > 0) {
                await selectTab(0)
            }
        } finally {
            const allOpened = paths.length > 0 && paths.every(p => tabs.value.some(tab => tab.path === p))
            restoringSession = false
            booted.value = true
            if (allOpened) syncSession()
        }
    }

    let loadingMore = false
    async function loadMore() {
        if (loadingMore || !hasMore.value || switchingWorkspace.value || useUiTransientStore().busy) return
        loadingMore = true
        try {
            const solo = soloBranch.value
            let page
            if (solo) {
                try {
                    page = await window.api.logSoloPage(solo, commits.value.length, PAGE_SIZE)
                } catch {
                    // branch is gone (deleted upstream) — fall back to the full graph
                    soloBranch.value = null
                    await refresh()
                    return
                }
            } else {
                page = await window.api.logPage(commits.value.length, PAGE_SIZE)
            }
            if (!page.length) {
                hasMore.value = false
                return
            }
            const seen = new Set(commits.value.map(c => c.hash))
            const fresh = page.filter(c => !seen.has(c.hash))
            // ref order may have shifted between pages (fetch/pull while scrolling) — if the
            // page mostly overlaps what we already have, a full refresh is the safe path
            if (fresh.length < page.length / 2) {
                await refresh()
                return
            }
            commits.value = [...commits.value, ...fresh]
            assignLanes(commits.value)
            hasMore.value = fresh.length >= PAGE_SIZE
        } finally {
            loadingMore = false
        }
    }

    async function setSolo(branch: string | null) {
        if (useUiTransientStore().busy) return
        const next = branch?.trim() ? branch.trim() : null
        if (next === soloBranch.value) return
        soloBranch.value = next
        selectedCommit.value = null
        selectedFile.value = null
        pendingFocusHash.value = null
        await refresh()
    }

    /** Terminal state of a repo (undefined when it owns no shell). */
    function repoTerminals(path: string): RepoTerminals | undefined {
        return path ? terminals.value[path] : undefined
    }

    /** True when the repo has at least one live shell (its panel stays mounted even while hidden). */
    function terminalExists(path: string): boolean {
        return (repoTerminals(path)?.ids.length ?? 0) > 0
    }

    /** Active repo's terminals — GraphView uses this for the toolbar button's title/active state. */
    const terminalSpawned = computed(() => terminalExists(tabs.value[activeTab.value]?.path ?? ''))

    /**
     * Every live shell across every repo — including repos parked in another workspace. The command
     * palette's "Terminate all terminals" is gated on this, and its confirm dialog counts with it.
     */
    const terminalCount = computed(() => Object.values(terminals.value).reduce((total, state) => total + state.ids.length, 0))
    /** How many repos own at least one shell (the palette item's hint). */
    const terminalRepoCount = computed(() => Object.values(terminals.value).filter(state => state.ids.length > 0).length)
    /** Shells whose repo is parked in another workspace — no open tab points at them (the confirm's note). */
    const terminalParkedCount = computed(() => {
        const open = new Set(tabs.value.map(tab => tab.path))
        return Object.entries(terminals.value).reduce((total, [path, state]) => (open.has(path) ? total : total + state.ids.length), 0)
    })

    /** True while the active repo's terminal panel is on screen (has a shell and isn't toggled away). */
    const terminalVisible = computed(() => {
        const state = repoTerminals(tabs.value[activeTab.value]?.path ?? '')
        return !!state && state.ids.length > 0 && !state.hidden
    })

    // Expanded is only meaningful while the panel is actually visible — hiding it (or switching to a
    // repo without a terminal) must never leave the graph hidden behind an invisible panel.
    watch(terminalVisible, visible => {
        if (!visible) terminalExpanded.value = false
    })

    function setRepoTerminals(path: string, state: RepoTerminals | null) {
        if (!path) return
        const next = { ...terminals.value }
        if (state) next[path] = state
        else delete next[path]
        terminals.value = next
    }

    /**
     * A workspace switch parks a repo that owns a shell: it stays registered in the main process so
     * the pty survives, even though no tab points at it. Once its last shell is gone nothing needs
     * that git instance anymore, and no later switch would ever collect it (they only walk the open
     * tabs) — so close it here instead of letting main's registry grow. Repos in the tab bar are
     * left alone: their tab owns their lifecycle (`closeTab` closes them explicitly).
     */
    function closeParkedRepo(path: string) {
        if (!path || tabs.value.some(tab => tab.path === path)) return
        void window.api.closeRepo(path).catch(() => {})
    }

    /**
     * Adds a shell tab for a repo (panel `+`). Returns its id, or null once the repo is at
     * MAX_TERMINALS_PER_REPO. Only flags it — the mounted panel spawns the pty for that id.
     */
    function openTerminalTab(path: string): string | null {
        const state = repoTerminals(path)
        if (!path || (state && state.ids.length >= MAX_TERMINALS_PER_REPO)) return null
        const id = `t${++terminalSeq}`
        // The tab number is assigned here, once, and never re-derived from the tab's position: dragging
        // a tab must not relabel it. The smallest free number keeps the set tidy (1..N for N tabs).
        const used = new Set(Object.values(state?.numbers ?? {}))
        let number = 1
        while (used.has(number)) number++
        setRepoTerminals(path, {
            ids: state ? [...state.ids, id] : [id],
            activeId: id,
            hidden: false,
            names: state?.names ?? {},
            numbers: { ...state?.numbers, [id]: number },
        })
        return id
    }

    /** Creation-time tab number of a shell (the "<n> <shell>" label) — stable across drag-reorder. */
    function terminalNumber(path: string, id: string): number {
        const state = repoTerminals(path)
        const stored = state?.numbers[id]
        if (stored) return stored
        // State written before `numbers` existed (or a mid-flight panel): fall back to the position.
        return (state?.ids.indexOf(id) ?? -1) + 1
    }

    /**
     * Renames one shell tab (right-click → Rename). An empty name clears it, so the tab goes back to
     * its positional "<n> <shell>" label. Names are plain labels — they never reach the pty.
     */
    function renameTerminal(path: string, id: string, name: string) {
        const state = repoTerminals(path)
        if (!state || !state.ids.includes(id)) return
        const trimmed = name.trim()
        const names = { ...state.names }
        if (trimmed) names[id] = trimmed
        else delete names[id]
        setRepoTerminals(path, { ...state, names })
    }

    /**
     * Moves a shell tab to another slot (drag & drop in the header). `activeId` is an id, not an
     * index, so the visible shell never changes — only the numbering of unnamed tabs.
     */
    function reorderTerminals(path: string, from: number, to: number) {
        const state = repoTerminals(path)
        if (!state || from === to) return
        if (from < 0 || to < 0 || from >= state.ids.length || to >= state.ids.length) return
        const ids = [...state.ids]
        const [moved] = ids.splice(from, 1)
        ids.splice(to, 0, moved)
        setRepoTerminals(path, { ...state, ids })
    }

    /** Which of a repo's terminals the panel shows. */
    function setActiveTerminal(path: string, id: string) {
        const state = repoTerminals(path)
        if (!state || state.activeId === id || !state.ids.includes(id)) return
        setRepoTerminals(path, { ...state, activeId: id })
    }

    /**
     * Kills one shell (its tab ✕, or the shell exiting on its own). When the last one goes the repo
     * loses its entry entirely, which unmounts the panel — the header ✕ / tab ✕ both confirm first,
     * a self-exiting shell does not (the process is already gone).
     */
    function closeTerminalTab(path: string, id: string) {
        const state = repoTerminals(path)
        const index = state?.ids.indexOf(id) ?? -1
        if (!state || index < 0) return
        void window.api.terminalDispose(id).catch(() => {})
        const ids = state.ids.filter(existing => existing !== id)
        if (!ids.length) {
            setRepoTerminals(path, null)
            closeParkedRepo(path)
            terminalExpanded.value = false
            return
        }
        // Hand focus to the tab that slid into this one's place, else the one before it.
        const activeId = state.activeId === id ? ids[Math.min(index, ids.length - 1)] : state.activeId
        // Ids are never reused, but drop the label and the number anyway so a closed tab leaves
        // nothing behind — its number becomes the smallest free one for the next shell.
        const names = { ...state.names }
        delete names[id]
        const numbers = { ...state.numbers }
        delete numbers[id]
        setRepoTerminals(path, { ...state, ids, activeId, names, numbers })
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
        setRepoTerminals(path, { ...state, hidden: true })
        terminalExpanded.value = false
    }

    /**
     * The graph toolbar button / Ctrl+` / palette "Terminal": create the first shell when the repo
     * has none, otherwise just show or hide the panel. It never kills anything — the ✕ buttons own that.
     */
    function toggleTerminalPanel(path: string) {
        const state = repoTerminals(path)
        if (!state) {
            openTerminalTab(path)
            return
        }
        if (state.hidden) showTerminals(path)
        else hideTerminals(path)
    }

    /** Kills every shell of a repo (the panel's ✕ after its confirm). */
    function closeRepoTerminals(path: string) {
        const state = repoTerminals(path)
        if (!state) return
        for (const id of state.ids) void window.api.terminalDispose(id).catch(() => {})
        setRepoTerminals(path, null)
        closeParkedRepo(path)
        terminalExpanded.value = false
    }

    /**
     * Drops a repo's terminal state without IPC — the main process already killed every pty for it
     * on `repo:close`, so the renderer must not pretend the shells are still around.
     */
    function forgetRepoTerminals(path: string) {
        if (!repoTerminals(path)) return
        setRepoTerminals(path, null)
        terminalExpanded.value = false
    }

    /**
     * Kills every shell of every repo, including the ones parked in another workspace — the user-driven
     * escape hatch behind the command palette's "Terminate all terminals". Workspace switches never call
     * this: they leave shells alone and keep their panels mounted (see `switchWorkspace`).
     */
    function closeAllTerminals() {
        const paths = Object.keys(terminals.value)
        const states = Object.values(terminals.value)
        terminalExpanded.value = false
        if (!states.length) return
        for (const state of states) {
            for (const id of state.ids) void window.api.terminalDispose(id).catch(() => {})
        }
        terminals.value = {}
        for (const path of paths) closeParkedRepo(path)
    }

    /** Expand/collapse the terminal over the center column. Collapsing restores the remembered height. */
    function setTerminalExpanded(expanded: boolean) {
        terminalExpanded.value = expanded
    }

    async function switchWorkspace(name: string) {
        if (useUiTransientStore().busy) return
        if (name === ws.active || !ws.names.includes(name)) return
        switchingWorkspace.value = true
        syncSession()
        ws.select(name)
        restoringSession = true
        try {
            const currentPaths = tabs.value.map(tab => tab.path)
            const saved = ws.getSession(name) ?? { paths: [], active: 0 }
            const targetPaths = new Set(saved.paths)
            // A workspace switch never kills a shell. Repos that still own one stay registered in the
            // main process (git instance + watcher) with their panel mounted, so the pty, whatever it
            // is running and its scrollback all survive — only the active tab's panel is on screen.
            // Repos with no shell are recycled exactly as before.
            await Promise.all(
                currentPaths
                    .filter(path => !targetPaths.has(path) && !terminalExists(path))
                    .map(path => window.api.closeRepo(path).catch(() => false))
            )
            tabs.value = []
            activeTab.value = 0
            commits.value = []
            selectedFile.value = null
            selectedConflict.value = null
            selectedCommit.value = null
            selectedStash.value = null
            soloBranch.value = null
            // Open concurrently (order preserved by Promise.all) — sequential spawning dominates
            // the switch cost on Windows. Shared repos reuse their existing git instance. addTab
            // skips refresh/sync while restoringSession is set, so exactly one full refresh happens below.
            const statuses = await Promise.all(saved.paths.map(path => window.api.openPath(path).catch(() => null)))
            for (const status of statuses) {
                if (status) addTab(status)
            }
            const savedActivePath = saved.paths[saved.active]
            const restored = savedActivePath ? tabs.value.findIndex(tab => tab.path === savedActivePath) : -1
            if (restored >= 0) {
                activeTab.value = restored
                await selectTab(restored, tabs.value[restored]?.status)
            } else if (tabs.value.length > 0) {
                await selectTab(0)
            }
        } finally {
            switchingWorkspace.value = false
            restoringSession = false
        }
        syncSession()
    }

    let commitDetailsRequest = 0
    watch(
        () => selectedCommit.value?.hash,
        async hash => {
            const request = ++commitDetailsRequest
            commitFiles.value = []
            commitMessage.value = ''
            commitAuthor.value = ''
            commitDate.value = ''
            loadingCommitDetails.value = !!hash
            if (!hash) return
            try {
                const details = await window.api.commitDetails(hash)
                if (selectedCommit.value?.hash === hash) {
                    commitFiles.value = details.files
                    commitMessage.value = details.message.trim()
                    commitAuthor.value = details.author
                    commitDate.value = details.date
                }
            } catch {
            } finally {
                if (request === commitDetailsRequest) loadingCommitDetails.value = false
            }
        },
        { immediate: true }
    )

    watch(
        () => selectedCommit.value?.hash,
        hash => {
            if (hash && selectedStash.value) selectedStash.value = null
        }
    )

    watch(
        () => selectedStash.value?.hash,
        async hash => {
            stashFiles.value = []
            if (!hash) return
            try {
                const files = await window.api.stashFiles(hash)
                if (selectedStash.value?.hash === hash) stashFiles.value = files
            } catch {}
        },
        { immediate: true }
    )

    // Note: there is intentionally no watcher on activeTab — selectTab/addTab own the
    // refresh for their tab change, so a watcher here would only duplicate full reloads
    // (status + log + branches + state) on every switch.

    return {
        tabs,
        activeTab,
        commits,
        branchList,
        tagList,
        loadingTags,
        loadingRemoteTags,
        remoteTagNames,
        hasRemote,
        refreshingRepo,
        logLimit,
        hasMore,
        selectedFile,
        selectedConflict,
        selectedCommit,
        selectedStash,
        pendingFocusHash,
        soloBranch,
        soloFiles,
        setSolo,
        terminals,
        terminalVisible,
        terminalSpawned,
        terminalCount,
        terminalRepoCount,
        terminalParkedCount,
        terminalHeight,
        terminalExpanded,
        repoTerminals,
        terminalExists,
        setTerminalExpanded,
        openTerminalTab,
        terminalNumber,
        renameTerminal,
        reorderTerminals,
        setActiveTerminal,
        closeTerminalTab,
        showTerminals,
        hideTerminals,
        toggleTerminalPanel,
        closeRepoTerminals,
        forgetRepoTerminals,
        closeAllTerminals,
        commitFiles,
        loadingCommitDetails,
        commitMessage,
        commitAuthor,
        commitDate,
        stashFiles,
        repoState,
        rebaseBase,
        historyFile,
        blameFile,
        previewFile,
        toolsOpen,
        toolsTab,
        reflogOpen,
        shortcutsOpen,
        commandPaletteOpen,
        repo,
        conflicts,
        oursLabel,
        theirsLabel,
        booted,
        switchingWorkspace,
        loadingRepo,
        addTab,
        refresh,
        refreshWithTags,
        refreshStatusOnly,
        selectTab,
        setActive,
        reorderTabs,
        closeTab,
        init,
        loadMore,
        switchWorkspace,
    }
})
