import type { CommitNode, RepoState, RepoStatus } from '@shared/types'

const PAGE_SIZE = 500

export interface RepoTab {
    path: string
    name: string
    status: RepoStatus
}

function loadSavedSession(): { paths: string[]; active: number } {
    try {
        const raw = localStorage.getItem('ogit-session')
        if (raw) return JSON.parse(raw) as { paths: string[]; active: number }
    } catch {
        /* ignore */
    }
    return { paths: [], active: 0 }
}

export const useRepoStore = defineStore('repo', () => {
    const tabs = ref<RepoTab[]>([])
    const activeTab = ref(0)
    const commits = ref<CommitNode[]>([])
    const logLimit = ref(PAGE_SIZE)
    const hasMore = ref(false)
    const selectedFile = ref<{ path: string; staged: boolean } | null>(null)
    const selectedCommit = ref<CommitNode | null>(null)
    const repoState = ref<RepoState>({ merging: false, rebasing: false, bisectActive: false })

    // modal states
    const rebaseBase = ref<string | null>(null)
    const historyFile = ref<string | null>(null)
    const blameFile = ref<string | null>(null)
    const toolsOpen = ref(false)

    const repo = computed<RepoStatus | null>(() => tabs.value[activeTab.value]?.status ?? null)
    const conflicts = computed(() => repo.value?.files.filter(f => f.staged === 'U' || f.unstaged === 'U').map(f => f.path) ?? [])

    function addTab(status: RepoStatus) {
        void window.api.recentAdd(status.path).catch(() => {})
        const existingIndex = tabs.value.findIndex(tab => tab.path === status.path)
        if (existingIndex >= 0) {
            tabs.value[existingIndex].status = status
            activeTab.value = existingIndex
            return
        }
        tabs.value.push({ path: status.path, name: status.name, status })
        activeTab.value = tabs.value.length - 1
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
            commits.value = log
            hasMore.value = log.length >= logLimit.value
            repoState.value = state
            const index = tabs.value.findIndex(tab => tab.path === status.path)
            if (index >= 0) tabs.value[index].status = status
            return branches
        } catch (error) {
            useUiStore().notify(String(error))
            return undefined
        }
    }

    async function selectTab(index: number) {
        const tab = tabs.value[index]
        if (!tab) return
        activeTab.value = index
        selectedFile.value = null
        selectedCommit.value = null
        await window.api.setActiveRepo(tab.path).catch(() => {})
        await refresh()
    }

    async function closeTab(index: number) {
        const tab = tabs.value[index]
        const stillOpen = await window.api.closeRepo(tab.path).catch(() => false)
        const remaining = tabs.value.filter((_, i) => i !== index)
        tabs.value = remaining
        activeTab.value = Math.max(0, activeTab.value > index ? activeTab.value - 1 : Math.min(activeTab.value, remaining.length - 1))
        if (remaining.length === 0) localStorage.removeItem('ogit-session')
        if (!stillOpen) {
            commits.value = []
            selectedCommit.value = null
        }
    }

    async function setActive(index: number) {
        activeTab.value = index
        await selectTab(index)
    }

    async function openPath(path: string) {
        addTab(await window.api.openPath(path))
    }

    /** Session restore on launch */
    async function init() {
        const saved = loadSavedSession()
        const paths = saved.paths.length ? saved.paths : (await window.api.recentList().catch(() => [] as string[])).slice(0, 1)
        let openedCount = 0
        for (const path of paths) {
            try {
                // oxlint-disable-next-line no-await-in-loop
                // oxlint-disable-next-line no-await-in-loop
                addTab(await window.api.openPath(path))
                openedCount++
            } catch {
                /* repo moved/deleted — skip */
            }
        }
        if (openedCount > 0 && saved.active > 0 && saved.active < tabs.value.length) {
            activeTab.value = saved.active
            await selectTab(activeTab.value)
        }
    }

    function loadMore() {
        logLimit.value += PAGE_SIZE
    }

    watch(logLimit, () => void refresh())
    watch([activeTab], () => {
        if (!repo.value) return
        void window.api
            .setActiveRepo(repo.value.path)
            .then(() => refresh())
            .catch(() => {})
    })

    // persist open tabs for next launch
    watch([tabs, activeTab], () => {
        if (!tabs.value.length) return
        localStorage.setItem('ogit-session', JSON.stringify({ paths: tabs.value.map(tab => tab.path), active: activeTab.value }))
    })

    return {
        tabs,
        activeTab,
        commits,
        logLimit,
        hasMore,
        selectedFile,
        selectedCommit,
        repoState,
        rebaseBase,
        historyFile,
        blameFile,
        toolsOpen,
        repo,
        conflicts,
        addTab,
        refresh,
        selectTab,
        setActive,
        closeTab,
        openPath,
        init,
        loadMore,
    }
})
