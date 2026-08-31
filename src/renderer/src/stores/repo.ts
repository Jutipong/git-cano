import type { CommitFile, CommitNode, RepoState, RepoStatus, StashEntry } from '@shared/types'

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
    const logLimit = ref(PAGE_SIZE)
    const hasMore = ref(false)
    const selectedFile = ref<{ path: string; staged: boolean } | null>(null)
    const selectedCommit = ref<CommitNode | null>(null)
    const selectedStash = ref<StashEntry | null>(null)
    const booted = ref(false)
    const commitFiles = ref<CommitFile[]>([])
    const commitMessage = ref('')
    const commitAuthor = ref('')
    const commitDate = ref('')
    const stashFiles = ref<CommitFile[]>([])
    const repoState = ref<RepoState>({ merging: false, rebasing: false, bisectActive: false })
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
    /** Which tab the tools modal should show when it opens (e.g. 'ai' from the AI commit dropdown). */
    const toolsTab = ref<'general' | 'auth' | 'hook' | 'ai'>('general')

    const pendingFocusHash = ref<string | null>(null)

    const repo = computed<RepoStatus | null>(() => tabs.value[activeTab.value]?.status ?? null)
    const conflicts = computed(() => repo.value?.files.filter(f => f.staged === 'U' || f.unstaged === 'U').map(f => f.path) ?? [])

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
        syncSession()
    }

    async function refresh() {
        try {
            const [status, log, branches, state] = await Promise.all([
                window.api.status(),
                window.api.log(logLimit.value),
                window.api.branches(),
                window.api.repoState(),
            ])
            if (!tabs.value.some(tab => tab.path === status.path)) return
            if (tabs.value[activeTab.value]?.path !== status.path) return
            commits.value = log
            hasMore.value = log.length >= logLimit.value
            repoState.value = state
            const index = tabs.value.findIndex(tab => tab.path === status.path)
            if (index >= 0) tabs.value[index].status = status
            return branches
        } catch (error) {
            useUiTransientStore().notify(String(error))
            return undefined
        }
    }

    async function selectTab(index: number) {
        if (useUiTransientStore().busy) return
        const tab = tabs.value[index]
        if (!tab) return
        activeTab.value = index
        selectedFile.value = null
        selectedCommit.value = null
        selectedStash.value = null
        syncSession()
        await window.api.setActiveRepo(tab.path).catch(() => {})
        await refresh()
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
            const saved = ws.getSession(ws.active) ?? session.value
            const savedActivePath = saved.paths[saved.active]
            paths = saved.paths.length ? saved.paths : (await window.api.recentList().catch(() => [] as string[])).slice(0, 1)
            let openedCount = 0
            for (const path of paths) {
                try {
                    // oxlint-disable-next-line no-await-in-loop
                    addTab(await window.api.openPath(path))
                    openedCount++
                } catch {}
            }
            const restoredActive = savedActivePath ? tabs.value.findIndex(tab => tab.path === savedActivePath) : -1
            if (openedCount > 0 && restoredActive >= 0) {
                activeTab.value = restoredActive
                await selectTab(activeTab.value)
            }
        } finally {
            const allOpened = paths.length > 0 && paths.every(p => tabs.value.some(tab => tab.path === p))
            restoringSession = false
            booted.value = true
            if (allOpened) syncSession()
        }
    }

    function loadMore() {
        logLimit.value += PAGE_SIZE
    }

    async function switchWorkspace(name: string) {
        if (useUiTransientStore().busy) return
        if (name === ws.active || !ws.names.includes(name)) return
        syncSession()
        ws.select(name)
        restoringSession = true
        try {
            const currentPaths = tabs.value.map(tab => tab.path)
            await Promise.all(currentPaths.map(path => window.api.closeRepo(path).catch(() => false)))
            tabs.value = []
            activeTab.value = 0
            commits.value = []
            selectedFile.value = null
            selectedCommit.value = null
            selectedStash.value = null
            const saved = ws.getSession(name) ?? { paths: [], active: 0 }
            let openedCount = 0
            for (const path of saved.paths) {
                try {
                    // oxlint-disable-next-line no-await-in-loop
                    addTab(await window.api.openPath(path))
                    openedCount++
                } catch {}
            }
            const savedActivePath = saved.paths[saved.active]
            const restored = savedActivePath ? tabs.value.findIndex(tab => tab.path === savedActivePath) : -1
            if (openedCount > 0 && restored >= 0) {
                activeTab.value = restored
                await selectTab(activeTab.value)
            }
        } finally {
            restoringSession = false
        }
        syncSession()
    }

    watch(
        () => selectedCommit.value?.hash,
        async hash => {
            commitFiles.value = []
            commitMessage.value = ''
            commitAuthor.value = ''
            commitDate.value = ''
            if (!hash) return
            try {
                const details = await window.api.commitDetails(hash)
                if (selectedCommit.value?.hash === hash) {
                    commitFiles.value = details.files
                    commitMessage.value = details.message.trim()
                    commitAuthor.value = details.author
                    commitDate.value = details.date
                }
            } catch {}
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

    watch(logLimit, () => void refresh())
    watch([activeTab], () => {
        if (!repo.value) return
        void window.api
            .setActiveRepo(repo.value.path)
            .then(() => refresh())
            .catch(() => {})
    })

    return {
        tabs,
        activeTab,
        commits,
        logLimit,
        hasMore,
        selectedFile,
        selectedCommit,
        selectedStash,
        pendingFocusHash,
        commitFiles,
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
        repo,
        conflicts,
        booted,
        addTab,
        refresh,
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
