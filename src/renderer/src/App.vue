<script setup lang="ts">
    import BlameModal from './components/BlameModal.vue'
    import ConflictBanner from './components/ConflictBanner.vue'
    import ConfirmDialog from './components/ConfirmDialog.vue'
    import DiffView from './components/DiffView.vue'
    import ErrorDialog from './components/ErrorDialog.vue'
    import FileHistoryModal from './components/FileHistoryModal.vue'
    import FilePanel from './components/FilePanel.vue'
    import GraphView from './components/GraphView.vue'
    import PromptDialog from './components/PromptDialog.vue'
    import RebaseEditor from './components/RebaseEditor.vue'
    import Sidebar from './components/Sidebar.vue'
    import TabBar from './components/TabBar.vue'
    import TagCreateModal from './components/TagCreateModal.vue'
    import ToolsModal from './components/ToolsModal.vue'

    import type { CommitNode, RepoStatus } from '@shared/types'
    import type { NotifyOptions, ToastKind } from './stores/uiTransient'

    import { confirmDialog } from './utils/confirm'
    import { promptDialog } from './utils/prompt'

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const { tabs, activeTab, commits, hasMore, selectedFile, selectedCommit, repoState, rebaseBase, historyFile, blameFile, toolsOpen, booted } =
        storeToRefs(repoStore)
    const repo = computed(() => repoStore.repo)
    const conflicts = computed(() => repoStore.conflicts)

    const resizeRef = ref<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
    const tagTarget = ref<CommitNode | null>(null)

    const SPLASH_MIN_MS = 1800
    const splashMinElapsed = ref(false)
    const splashVisible = computed(() => !booted.value || !splashMinElapsed.value)

    provide('notify', (message: string, type?: ToastKind, opts?: NotifyOptions) => uiTransient.notify(message, type, opts))

    function openNewRepo() {
        uiTransient
            .withBusy(() => window.api.pickAndOpen(), 'Opening repository…')
            .then((status: RepoStatus | null) => status && repoStore.addTab(status))
            .catch((error: unknown) => uiTransient.notify(String(error), 'error'))
    }

    function focusCommitSearch() {
        document.querySelector<HTMLInputElement>('.commit-search input')?.focus()
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

        const unwatch = window.api.onRepoChanged(debouncedRefresh)
        onUnmounted(unwatch)

        window.addEventListener('focus', debouncedRefresh)
        onUnmounted(() => window.removeEventListener('focus', debouncedRefresh))

        refreshInterval.value = setInterval(
            () => {
                if (repoStore.repo) void repoStore.refresh()
            },
            60 * 1000
        )

        const onKeyDown = (event: KeyboardEvent) => {
            if (uiTransient.busy) return
            if (event.key === 'Escape') {
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
                focusCommitSearch()
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
            if (resize.side === 'left') ui.sidebarWidth = Math.min(380, Math.max(300, resize.startWidth + delta))
            else ui.rightPanelWidth = Math.min(500, Math.max(346, resize.startWidth - delta))
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

    async function run(label: string, fn: () => Promise<unknown>, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(fn, busyLabel)
            await repoStore.refresh()
            uiTransient.notify(label, 'success')
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function checkoutCommit(commit: CommitNode) {
        void run(`Checked out ${commit.shortHash}`, () => window.api.checkoutCommit(commit.hash), `Checking out ${commit.shortHash}…`)
    }

    async function createBranchAt(commit: CommitNode) {
        const existing = await window.api
            .branches()
            .then(branches => branches.local.map(branch => branch.name))
            .catch(() => [] as string[])
        const name = await promptDialog({
            title: 'Create branch here…',
            message: `New branch at ${commit.shortHash} — ${commit.subject}`,
            placeholder: 'branch name',
            confirmLabel: 'Create',
            existing,
        })
        if (name?.trim()) void run(`Created branch ${name.trim()}`, () => window.api.createBranch(name.trim(), false, commit.hash), `Creating branch ${name.trim()}…`)
    }

    function cherryPickCommit(commit: CommitNode) {
        void run('Cherry-picked', () => window.api.cherryPick(commit.hash), 'Cherry-picking…')
    }

    async function revertCommit(commit: CommitNode) {
        const ok = await confirmDialog({
            message: `Revert commit ${commit.shortHash}?`,
            confirmLabel: 'Revert',
        })
        if (!ok) return
        void run('Commit reverted', () => window.api.revertCommit(commit.hash), 'Reverting commit…')
    }

    async function resetTo(commit: CommitNode, mode: 'soft' | 'hard') {
        const ok = await confirmDialog({
            message:
                mode === 'soft'
                    ? `Soft reset "${repoStore.repo?.branch}" to ${commit.shortHash}?\nAll changes stay staged (nothing is lost).`
                    : `Hard reset "${repoStore.repo?.branch}" to ${commit.shortHash}?\nAll uncommitted changes will be lost.`,
            confirmLabel: mode === 'soft' ? 'Reset (soft)' : 'Reset (hard)',
            danger: mode === 'hard',
        })
        if (!ok) return
        void run(`Reset to ${commit.shortHash} (${mode})`, () => window.api.resetTo(commit.hash, mode), `Resetting to ${commit.shortHash}…`)
    }

    function closeCommitView() {
        selectedFile.value = null
        selectedCommit.value = null
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
                            @select-commit="selectedCommit = $event"
                            @load-more="repoStore.loadMore()"
                            @checkout="checkoutCommit"
                            @create-branch="createBranchAt"
                            @create-tag="tagTarget = $event"
                            @cherry-pick="cherryPickCommit"
                            @revert="revertCommit"
                            @reset-soft="commit => resetTo(commit, 'soft')"
                            @reset-hard="commit => resetTo(commit, 'hard')" />
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
                            @show-blame="blameFile = $event"
                             @close-commit="closeCommitView" />
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
        <div
            v-if="uiTransient.busy"
            class="busy-overlay">
            <div class="busy-card">
                <i-lucide-loader-circle
                    class="spinning"
                    width="18"
                    height="18" />
                <span>{{ uiTransient.busy }}</span>
            </div>
        </div>
        <ConfirmDialog />
        <PromptDialog />
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
                    <span class="toast-message">{{ t.message }}</span>
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
        <Transition name="splash">
            <div
                v-if="splashVisible"
                class="splash-screen">
                <div class="splash-card">
                    <div class="splash-logo">
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
