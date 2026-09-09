import { assignLanes } from '@shared/lanes'

import type { BranchInfo, CommitFile, CommitNode, RepoState, RepoStatus, StashEntry } from '@shared/types'

const PAGE_SIZE = 500

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
    const repoState = ref<RepoState>({ merging: false, rebasing: false, cherryPicking: false, bisectActive: false })
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
    const toolsOpen = ref(false)
    /** Whether the keyboard-shortcuts help modal is open. */
    const shortcutsOpen = ref(false)
    /** Whether the command palette overlay is open. */
    const commandPaletteOpen = ref(false)
    /** Which tab the tools modal should show when it opens (e.g. 'ai' from the AI commit dropdown). */
    const toolsTab = ref<'appearance' | 'general' | 'shortcuts' | 'auth' | 'ai'>('appearance')

    const pendingFocusHash = ref<string | null>(null)
    /** Branch soloed in the graph (GitKraken-style focus) — view-only filter, never persisted. */
    const soloBranch = ref<string | null>(null)
    /** Files touched by the soloed branch's visible commits (Focus dimming) — null when not soloed. */
    const soloFiles = ref<string[] | null>(null)
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

    /** Labels for the two sides of a merge conflict (shared by FilePanel and ConflictView). */
    const oursLabel = computed(() => (repoState.value.merging ? repo.value?.branch || 'ours' : 'ours'))
    const theirsLabel = computed(() => (repoState.value.merging ? repoState.value.mergeSource || 'theirs' : 'theirs'))

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

    async function refresh(precomputedStatus?: RepoStatus, switching = false) {
        const targetPath = tabs.value[activeTab.value]?.path
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
            const [status, log, branches, state, tags, remote, focused] = await Promise.all([
                precomputedStatus ? Promise.resolve(precomputedStatus) : window.api.status(),
                logPromise,
                window.api.branches(),
                window.api.repoState(),
                loadTags(),
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
            tagList.value = tags
            hasRemote.value = remote
            loadedPath.value = status.path
            const index = tabs.value.findIndex(tab => tab.path === status.path)
            if (index >= 0) tabs.value[index].status = status
            // Remote tag lookup is network-bound; do not hold repository switching on it.
            void loadRemoteTags(status.path)
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
        const wasActive = index === activeTab.value
        const stillOpen = await window.api.closeRepo(tab.path).catch(() => false)
        const remaining = tabs.value.filter((_, i) => i !== index)
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

    async function openPath(path: string) {
        if (useUiTransientStore().busy) return
        addTab(await window.api.openPath(path))
    }

    async function init() {
        restoringSession = true
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
            // Keep repositories shared by both workspaces open; only close repos that are no longer needed.
            await Promise.all(
                currentPaths.filter(path => !targetPaths.has(path)).map(path => window.api.closeRepo(path).catch(() => false))
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
        toolsOpen,
        toolsTab,
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
        refreshStatusOnly,
        selectTab,
        setActive,
        reorderTabs,
        closeTab,
        openPath,
        init,
        loadMore,
        switchWorkspace,
    }
})
