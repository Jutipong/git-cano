<script setup lang="ts">
    import BlameModal from './components/BlameModal.vue'
    import ConflictBanner from './components/ConflictBanner.vue'
    import ConfirmDialog from './components/ConfirmDialog.vue'
    import DiffView from './components/DiffView.vue'
    import ErrorDialog from './components/ErrorDialog.vue'
    import FileHistoryModal from './components/FileHistoryModal.vue'
    import FilePanel from './components/FilePanel.vue'
    import GraphView from './components/GraphView.vue'
    import RebaseEditor from './components/RebaseEditor.vue'
    import Sidebar from './components/Sidebar.vue'
    import TabBar from './components/TabBar.vue'
    import TagCreateModal from './components/TagCreateModal.vue'
    import ToolsModal from './components/ToolsModal.vue'

    import type { CommitNode, MenuItem, RepoStatus } from '@shared/types'
    import type { ToastKind } from './stores/uiTransient'

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const { tabs, activeTab, commits, hasMore, selectedFile, selectedCommit, repoState, rebaseBase, historyFile, blameFile, toolsOpen, booted } =
        storeToRefs(repoStore)
    const repo = computed(() => repoStore.repo)
    const conflicts = computed(() => repoStore.conflicts)

    const resizeRef = ref<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
    const tagTarget = ref<CommitNode | null>(null)

    // keep the splash on screen at least this long so the brand is readable even
    // when the session restores almost instantly (will host a logo image later)
    const SPLASH_MIN_MS = 1800
    const splashMinElapsed = ref(false)
    const splashVisible = computed(() => !booted.value || !splashMinElapsed.value)

    // toast notifications สำหรับทุก component ที่ inject('notify')
    provide('notify', (message: string, type?: ToastKind) => uiTransient.notify(message, type))

    function openNewRepo() {
        window.api
            .pickAndOpen()
            .then((status: RepoStatus | null) => status && repoStore.addTab(status))
            .catch((error: unknown) => uiTransient.notify(String(error), 'error'))
    }

    const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    function debouncedRefresh() {
        if (!repoStore.repo) return
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
            refreshTimer = null
            void repoStore.refresh()
        }, 400)
    }

    onMounted(() => {
        void repoStore.init()
        void useAiStore().load()
        setTimeout(() => (splashMinElapsed.value = true), SPLASH_MIN_MS)

        // instant refresh when the repo changes outside the app (terminal commits, etc.)
        const unwatch = window.api.onRepoChanged(debouncedRefresh)
        onUnmounted(unwatch)

        // refresh when returning to the app window
        window.addEventListener('focus', debouncedRefresh)
        onUnmounted(() => window.removeEventListener('focus', debouncedRefresh))

        // polling fallback (1 minute)
        refreshInterval.value = setInterval(
            () => {
                if (repoStore.repo) void repoStore.refresh()
            },
            60 * 1000
        )

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // close diff overlay first, then commit details
                if (selectedFile.value) selectedFile.value = null
                else if (selectedCommit.value) selectedCommit.value = null
                return
            }
            if (!(event.metaKey || event.ctrlKey)) return
            if (event.key.toLowerCase() === 'r' && !event.shiftKey) {
                event.preventDefault()
                void repoStore.refresh()
                uiTransient.notify('Repository refreshed', 'success')
            }
            if (event.shiftKey && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                document.querySelector<HTMLInputElement>('.commit-search input')?.focus()
            }
            if (event.shiftKey && event.key.toLowerCase() === 'p') {
                event.preventDefault()
                openNewRepo()
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
                uiTransient.notify(label, 'success')
            } catch (error) {
                uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
            }
        }
        return [
            {
                label: 'Copy full hash',
                action: () =>
                    void navigator.clipboard
                        .writeText(commit.hash)
                        .then(() => uiTransient.notify('Hash copied', 'success'))
                        .catch(() => uiTransient.notify('Copy failed', 'error')),
            },
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
                    tagTarget.value = commit
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
    <div class="app">
        <template v-if="repo">
            <Sidebar
                :repo="repo"
                :refresh="repoStore.refresh"
                @interactive-rebase="rebaseBase = $event" />
            <div
                class="panel-splitter"
                @mousedown="event => beginResize('left', event)" />
            <div class="app-main">
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
                    @open-new="openNewRepo()"
                    @reorder="(from, to) => repoStore.reorderTabs(from, to)" />
                <div class="app-body">
                    <div class="center-column">
                        <GraphView
                            :commits="commits"
                            :has-more="hasMore"
                            :commit-open="!!selectedCommit"
                            :build-commit-menu="buildCommitMenu"
                            @select-commit="selectedCommit = $event"
                            @close-commit="selectedCommit = null"
                            @load-more="repoStore.loadMore()" />
                    </div>
                    <div
                        class="panel-splitter"
                        @mousedown="event => beginResize('right', event)" />
                    <div
                        class="right-pane"
                        :style="{ width: `${ui.rightPanelWidth}px`, flexBasis: `${ui.rightPanelWidth}px` }">
                        <FilePanel
                            :files="selectedCommit ? repoStore.commitFiles : repo.files"
                            :mode="selectedCommit ? 'commit' : 'workdir'"
                            :commit-hash="selectedCommit?.hash"
                            :selected="selectedFile"
                            :commit-message="repoStore.commitMessage"
                            :commit-author="repoStore.commitAuthor"
                            :commit-date="repoStore.commitDate"
                            :refresh="repoStore.refresh"
                            @select="selectedFile = $event"
                            @show-history="historyFile = $event"
                            @show-blame="blameFile = $event" />
                    </div>
                </div>
            </div>
        </template>
        <div
            v-if="!repo"
            class="app-empty">
            <i-lucide-folder-git2
                width="42"
                height="42" />
            <strong>No repository opened</strong>
            <span>Open a repository to see its graph, branches and changes</span>
            <button
                class="btn primary"
                @click="openNewRepo()">
                <i-lucide-plus
                    width="15"
                    height="15" />
                Open repository
            </button>
        </div>
        <!-- diff overlay: floats over tab bar + sidebar + graph, stops before the right pane -->
        <DiffView
            v-if="selectedFile && repo"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="selectedFile"
            :commit-hash="selectedCommit?.hash ?? undefined"
            :refresh="repoStore.refresh"
            @close="selectedFile = null" />
        <RebaseEditor
            v-if="rebaseBase"
            :base-ref="rebaseBase"
            @cancel="rebaseBase = null"
            @complete="
                message => {
                    rebaseBase = null
                    void repoStore.refresh()
                    uiTransient.notify(message, 'success')
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
        <TagCreateModal
            v-if="tagTarget"
            :commit="tagTarget"
            @close="tagTarget = null" />
        <ToolsModal
            v-if="toolsOpen"
            :bisect-active="repoState.bisectActive"
            :refresh="repoStore.refresh"
            @close="toolsOpen = false" />
        <ErrorDialog
            :message="uiTransient.errorDialog"
            @close="uiTransient.closeErrorDialog()" />
        <ConfirmDialog />
        <div class="toast-stack">
            <TransitionGroup name="toast">
                <div
                    v-for="t in uiTransient.toasts"
                    :key="t.id"
                    class="toast"
                    :class="`toast-${t.type}`"
                    role="status">
                    <span
                        class="toast-icon"
                        aria-hidden="true">
                        <i-lucide-arrow-down-to-line
                            v-if="t.type === 'fetch'"
                            width="13"
                            height="13" />
                        <i-lucide-arrow-down
                            v-else-if="t.type === 'pull'"
                            width="13"
                            height="13" />
                        <i-lucide-arrow-up
                            v-else-if="t.type === 'push'"
                            width="13"
                            height="13" />
                        <i-lucide-archive
                            v-else-if="t.type === 'stash'"
                            width="13"
                            height="13" />
                        <template v-else>
                            {{ t.type === 'error' ? '×' : t.type === 'warning' ? '!' : t.type === 'info' ? 'i' : '✓' }}
                        </template>
                    </span>
                    <span>{{ t.message }}</span>
                    <button
                        class="toast-close"
                        title="Dismiss"
                        @click="uiTransient.dismissToast(t.id)">
                        <svg
                            class="toast-ring"
                            width="22"
                            height="22"
                            viewBox="0 0 22 22"
                            aria-hidden="true">
                            <circle
                                class="toast-ring-track"
                                cx="11"
                                cy="11"
                                r="9" />
                            <circle
                                class="toast-ring-progress"
                                cx="11"
                                cy="11"
                                r="9"
                                :stroke-dasharray="2 * Math.PI * 9"
                                :stroke-dashoffset="2 * Math.PI * 9 * (1 - t.progress)" />
                        </svg>
                        <i-lucide-x
                            class="toast-close-icon"
                            width="11"
                            height="11" />
                    </button>
                </div>
            </TransitionGroup>
        </div>
        <!-- full-window splash while the saved session restores; fades out when booted -->
        <Transition name="splash">
            <div
                v-if="splashVisible"
                class="splash-screen">
                <div class="splash-card">
                    <div class="splash-logo">
                        <!-- TODO: swap for a real logo image once an asset exists -->
                        <i-lucide-folder-git2
                            width="34"
                            height="34" />
                    </div>
                    <strong class="splash-title">Open Git</strong>
                    <div
                        class="splash-bar"
                        aria-hidden="true" />
                    <span class="splash-muted">Restoring your repositories…</span>
                </div>
            </div>
        </Transition>
    </div>
</template>
