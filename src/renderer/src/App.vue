<script setup lang="ts">
    import BlameModal from './components/BlameModal.vue'
    import CommitDetails from './components/CommitDetails.vue'
    import ConflictBanner from './components/ConflictBanner.vue'
    import DiffView from './components/DiffView.vue'
    import FileHistoryModal from './components/FileHistoryModal.vue'
    import FilePanel from './components/FilePanel.vue'
    import GraphView from './components/GraphView.vue'
    import RebaseEditor from './components/RebaseEditor.vue'
    import Sidebar from './components/Sidebar.vue'
    import TabBar from './components/TabBar.vue'
    import Toolbar from './components/Toolbar.vue'
    import ToolsModal from './components/ToolsModal.vue'

    import type { CommitNode, MenuItem, RepoStatus } from '@shared/types'

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const { tabs, activeTab, commits, hasMore, selectedFile, selectedCommit, repoState, rebaseBase, historyFile, blameFile, toolsOpen } =
        storeToRefs(repoStore)
    const repo = computed(() => repoStore.repo)
    const conflicts = computed(() => repoStore.conflicts)

    const resizeRef = ref<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)

    // toast notifications สำหรับทุก component ที่ inject('notify')
    provide('notify', (message: string) => ui.notify(message))

    function openNewRepo() {
        window.api
            .pickAndOpen()
            .then((status: RepoStatus | null) => status && repoStore.addTab(status))
            .catch((error: unknown) => ui.notify(String(error)))
    }

    const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)

    onMounted(() => {
        void repoStore.init()

        // lightweight auto-refresh (5 minutes)
        refreshInterval.value = setInterval(() => {
            if (repoStore.repo) void repoStore.refresh()
        }, 5 * 60 * 1000)

        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey)) return
            if (event.key.toLowerCase() === 'r' && !event.shiftKey) {
                event.preventDefault()
                void repoStore.refresh()
                ui.notify('Repository refreshed')
            }
            if (event.shiftKey && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                document.querySelector<HTMLInputElement>('.commit-search input')?.focus()
            }
            if (event.shiftKey && event.key.toLowerCase() === 'p') {
                event.preventDefault()
                openNewRepo()
            }
            if (event.key === 'Escape') {
                // close diff overlay first, then commit details
                if (selectedFile.value) selectedFile.value = null
                else if (selectedCommit.value) selectedCommit.value = null
            }
        }

        onBeforeUnmount(() => {
            if (refreshInterval.value) clearInterval(refreshInterval.value)
            window.removeEventListener('keydown', onKeyDown)
        })
        window.addEventListener('keydown', onKeyDown)
    })

    function beginResize(side: 'left' | 'right', event: MouseEvent) {
        event.preventDefault()
        resizeRef.value = {
            side,
            startX: event.clientX,
            startWidth: side === 'left' ? ui.sidebarWidth : ui.rightPanelWidth,
        }
        const onMove = (moveEvent: MouseEvent) => {
            const resize = resizeRef.value
            if (!resize) return
            const delta = moveEvent.clientX - resize.startX
            if (resize.side === 'left') ui.sidebarWidth = Math.min(380, Math.max(190, resize.startWidth + delta))
            else ui.rightPanelWidth = Math.min(600, Math.max(320, resize.startWidth - delta))
        }
        const onEnd = () => {
            resizeRef.value = null
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onEnd)
        }
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onEnd)
    }

    function buildCommitMenu(commit: CommitNode): MenuItem[] {
        const run = async (label: string, fn: () => Promise<unknown>, confirmText?: string) => {
            if (confirmText && !window.confirm(confirmText)) return
            try {
                await fn()
                await repoStore.refresh()
                ui.notify(label)
            } catch (error) {
                ui.notify(String(error).replace(/^Error:\s*/, ''))
            }
        }
        return [
            {
                label: `Checkout ${commit.shortHash}`,
                action: () => void run(`Checked out ${commit.shortHash}`, () => window.api.checkoutCommit(commit.hash)),
            },
            {
                label: 'Create branch here…',
                action: () => {
                    const name = window.prompt(`Create branch at ${commit.shortHash}:`)
                    if (name?.trim()) void run(`Created branch ${name.trim()}`, () => window.api.createBranch(name.trim(), false))
                },
            },
            {
                label: 'Create tag here…',
                action: () => {
                    const name = window.prompt(`Tag name at ${commit.shortHash}:`)
                    if (name?.trim()) void run(`Tag ${name.trim()} created`, () => window.api.createTag(name.trim(), commit.hash))
                },
            },
            {
                label: 'Cherry-pick onto HEAD',
                separatorBefore: true,
                action: () => void run('Cherry-picked', () => window.api.cherryPick(commit.hash)),
            },
            {
                label: 'Revert this commit',
                action: () => void run('Commit reverted', () => window.api.revertCommit(commit.hash), `Revert commit ${commit.shortHash}?`),
            },
            {
                label: `Reset current branch to ${commit.shortHash} (hard)`,
                danger: true,
                separatorBefore: true,
                action: () =>
                    void run(
                        `Reset to ${commit.shortHash}`,
                        () => window.api.resetTo(commit.hash, 'hard'),
                        `Hard reset "${repoStore.repo?.branch}" to ${commit.shortHash}?\nAll uncommitted changes will be lost.`
                    ),
            },
        ]
    }
</script>

<template>
    <Welcome
        v-if="!repo"
        @opened="repoStore.addTab($event)" />

    <div
        v-else
        class="app">
        <Toolbar
            :repo="repo"
            :refresh="repoStore.refresh"
            :bisect-active="repoState.bisectActive"
            v-model:search="ui.searchQuery" />
        <ConflictBanner
            v-if="repoState.merging || repoState.rebasing || conflicts.length"
            :conflicts="conflicts"
            :state="repoState"
            :refresh="repoStore.refresh" />
        <TabBar
            :tabs="tabs"
            :active-index="activeTab"
            @select="index => repoStore.setActive(index)"
            @close="repoStore.closeTab($event)"
            @open-new="openNewRepo()" />
        <div class="app-body">
            <Sidebar
                :repo="repo"
                :refresh="repoStore.refresh"
                @interactive-rebase="rebaseBase = $event" />
            <div
                class="panel-splitter"
                @mousedown="event => beginResize('left', event)" />
            <div class="center-column">
                <GraphView
                    :commits="commits"
                    :query="ui.searchQuery"
                    :has-more="hasMore"
                    :build-commit-menu="buildCommitMenu"
                    @select-commit="selectedCommit = $event"
                    @load-more="repoStore.loadMore()" />
                <CommitDetails
                    v-if="selectedCommit"
                    :commit="selectedCommit"
                    :notify="ui.notify" />
            </div>
            <div
                class="panel-splitter"
                @mousedown="event => beginResize('right', event)" />
            <div
                class="right-pane"
                :style="{ width: `${ui.rightPanelWidth}px`, flexBasis: `${ui.rightPanelWidth}px` }">
                <FilePanel
                    :files="repo.files"
                    :selected="selectedFile"
                    :refresh="repoStore.refresh"
                    @select="selectedFile = $event"
                    @show-history="historyFile = $event"
                    @show-blame="blameFile = $event" />
                <DiffView
                    :file="selectedFile"
                    :refresh="repoStore.refresh" />
            </div>
        </div>
        <RebaseEditor
            v-if="rebaseBase"
            :base-ref="rebaseBase"
            @cancel="rebaseBase = null"
            @complete="
                message => {
                    rebaseBase = null
                    void repoStore.refresh()
                    ui.notify(message)
                }
            " />
        <FileHistoryModal
            v-if="historyFile"
            :file="historyFile"
            @close="historyFile = null" />
        <BlameModal
            v-if="blameFile"
            :file="blameFile"
            @close="blameFile = null" />
        <ToolsModal
            v-if="toolsOpen"
            :bisect-active="repoState.bisectActive"
            :refresh="repoStore.refresh"
            @close="toolsOpen = false" />
        <div
            v-if="ui.toast"
            class="toast">
            {{ ui.toast }}
        </div>
    </div>
</template>
