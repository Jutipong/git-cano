<script setup lang="ts">
    import BlameModal from './components/BlameModal.vue'
    import CloneRepoModal from './components/CloneRepoModal.vue'
    import CommandPalette from './components/CommandPalette.vue'
    import ConfirmDialog from './components/ConfirmDialog.vue'
    import ConflictView from './components/ConflictView.vue'
    import DiffView from './components/DiffView.vue'
    import ErrorDialog from './components/ErrorDialog.vue'
    import FileHistoryModal from './components/FileHistoryModal.vue'
    import FilePanel from './components/FilePanel.vue'
    import GraphView from './components/GraphView.vue'
    import KittScanner from './components/KittScanner.vue'
    import OpenRepoMenu from './components/OpenRepoMenu.vue'
    import PromptDialog from './components/PromptDialog.vue'
    import RebaseEditor from './components/RebaseEditor.vue'
    import ShortcutsModal from './components/ShortcutsModal.vue'
    import Sidebar from './components/Sidebar.vue'
    import SquashModal from './components/SquashModal.vue'
    import StashCreateModal from './components/StashCreateModal.vue'
    import SwitchDialog from './components/SwitchDialog.vue'
    import TabBar from './components/TabBar.vue'
    import TagCreateModal from './components/TagCreateModal.vue'
    import ThinkSpinner from './components/ThinkSpinner.vue'
    import ToolsModal from './components/ToolsModal.vue'
    import WorkspaceButton from './components/WorkspaceButton.vue'
    import { useAuthStore } from './stores/auth'
    import { DEFAULT_ZOOM } from './stores/ui'
    import { useWorkspaceStore } from './stores/workspace'
    import { confirmDialog } from './utils/confirm'
    import { promptDialog } from './utils/prompt'
    import { eventToCombo } from './utils/shortcuts'
    import { notifyUndoable } from './utils/undo'

    import type { NotifyOptions, ToastKind } from './stores/uiTransient'
    import type { CommitNode, RepoStatus } from '@shared/types'
    import canoIcon from './assets/cano.svg'

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const auth = useAuthStore()
    const wsStore = useWorkspaceStore()
    const syncStore = useSyncStore()
    const {
        tabs,
        activeTab,
        commits,
        hasMore,
        selectedFile,
        selectedConflict,
        selectedCommit,
        selectedStash,
        rebaseBase,
        historyFile,
        blameFile,
        toolsOpen,
        booted,
        switchingWorkspace,
    } = storeToRefs(repoStore)
    const repo = computed(() => repoStore.repo)

    const RIGHT_PANEL_MIN_WIDTH = 360
    if (ui.rightPanelWidth < RIGHT_PANEL_MIN_WIDTH) ui.rightPanelWidth = RIGHT_PANEL_MIN_WIDTH

    /** Conflicted rows open ConflictView; everything else opens DiffView (mutually exclusive). */
    function selectFilePanel(sel: { path: string; staged: boolean } | null) {
        if (sel && repoStore.conflicts.includes(sel.path)) {
            selectedFile.value = null
            selectedConflict.value = { path: sel.path }
        } else {
            selectedConflict.value = null
            selectedFile.value = sel
        }
    }

    function selectCommit(commit: CommitNode) {
        selectedFile.value = null
        selectedConflict.value = null
        selectedStash.value = null
        selectedCommit.value = commit
    }

    const SIDEBAR_MIN_WIDTH = 280
    if (ui.sidebarWidth < SIDEBAR_MIN_WIDTH) ui.sidebarWidth = SIDEBAR_MIN_WIDTH

    const resizeRef = ref<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
    const tagTarget = ref<CommitNode | null>(null)
    const squashTarget = ref<CommitNode | null>(null)
    const stashCreateOpen = ref(false)
    const cloneOpen = ref(false)

    const SPLASH_MIN_MS = 1800
    const splashMinElapsed = ref(false)
    const splashVisible = computed(() => !booted.value || !splashMinElapsed.value || switchingWorkspace.value)
    const splashText = computed(() => (switchingWorkspace.value ? 'Switching workspace…' : 'Restoring your repositories…'))
    const showEmptyWorkspace = computed(() => wsStore.names.some(name => name !== wsStore.active))

    provide('notify', (message: string, type?: ToastKind, opts?: NotifyOptions) => uiTransient.notify(message, type, opts))

    function openNewRepo() {
        uiTransient
            .withBusy(() => window.api.pickAndOpen(), 'Opening repository…')
            .then((status: RepoStatus | null) => status && repoStore.addTab(status))
            .catch((error: unknown) => uiTransient.notify(String(error), 'error'))
    }

    const autoRefreshTimer = ref<ReturnType<typeof setInterval> | null>(null)
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    function startAutoRefresh() {
        if (autoRefreshTimer.value) {
            clearInterval(autoRefreshTimer.value)
            autoRefreshTimer.value = null
        }
        const minutes = ui.refreshInterval
        if (!minutes || minutes <= 0) return
        autoRefreshTimer.value = setInterval(
            () => {
                if (repoStore.repo) void repoStore.refresh()
            },
            minutes * 60 * 1000
        )
    }

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
        void auth.load()
        setTimeout(() => (splashMinElapsed.value = true), SPLASH_MIN_MS)

        const unwatch = window.api.onRepoChanged(debouncedRefresh)
        onUnmounted(unwatch)

        // Window focus fires often (alt-tab) — use the light status-only refresh (1 spawn) and
        // escalate to a full refresh only when something actually changed. Real git activity
        // still arrives via onRepoChanged (debouncedRefresh, full refresh below).
        const onFocus = () => {
            if (repoStore.repo) void repoStore.refreshStatusOnly()
        }
        window.addEventListener('focus', onFocus)
        onUnmounted(() => window.removeEventListener('focus', onFocus))

        startAutoRefresh()
        watch(() => ui.refreshInterval, startAutoRefresh)

        // double-Shift detection for the command palette (two taps within the window)
        const DOUBLE_SHIFT_MS = 400
        let lastShiftTap = 0

        const onKeyDown = (event: KeyboardEvent) => {
            // app zoom shortcuts — kept above the busy gate so zooming always works
            if (event.metaKey || event.ctrlKey) {
                if (event.key === '=' || event.key === '+') {
                    event.preventDefault()
                    ui.stepZoom(1)
                    return
                }
                if (event.key === '-') {
                    event.preventDefault()
                    ui.stepZoom(-1)
                    return
                }
                if (event.key === '0') {
                    event.preventDefault()
                    ui.zoom = DEFAULT_ZOOM
                    return
                }
            }
            if (uiTransient.busy) return
            if (event.key === 'Escape') {
                if (historyFile.value || blameFile.value) return
                if (selectedConflict.value) selectedConflict.value = null
                else if (selectedFile.value) selectedFile.value = null
                else if (selectedCommit.value) selectedCommit.value = null
                else if (selectedStash.value) selectedStash.value = null
                return
            }
            // double-Shift opens the command palette — ignored while typing in text fields,
            // otherwise capital letters would fire it
            if (event.key === 'Shift' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const target = event.target as HTMLElement | null
                if (!target?.closest('input, textarea, [contenteditable="true"]')) {
                    const now = Date.now()
                    if (now - lastShiftTap < DOUBLE_SHIFT_MS) {
                        lastShiftTap = 0
                        event.preventDefault()
                        repoStore.commandPaletteOpen = !repoStore.commandPaletteOpen
                        return
                    }
                    lastShiftTap = now
                }
            }
            if (!(event.metaKey || event.ctrlKey)) {
                // '?' opens the shortcuts help modal (only outside text inputs)
                if (event.key === '?' && !event.altKey) {
                    const target = event.target as HTMLElement | null
                    if (target?.closest('input, textarea, [contenteditable="true"]')) return
                    event.preventDefault()
                    repoStore.shortcutsOpen = true
                }
                return
            }

            // Customizable shortcuts (Settings → Shortcuts) — canonical combos, so Ctrl and Cmd both work.
            const combo = eventToCombo(event)

            // Open repo
            if (combo && combo === ui.getShortcut('openRepo')) {
                event.preventDefault()
                openNewRepo()
                return
            }
            // Open settings
            if (combo && combo === ui.getShortcut('settings')) {
                event.preventDefault()
                repoStore.toolsOpen = true
                return
            }
            // Command palette (double-Shift is handled above)
            if (combo && combo === ui.getShortcut('commandPalette')) {
                event.preventDefault()
                repoStore.commandPaletteOpen = !repoStore.commandPaletteOpen
                return
            }
            // Focus commit-history search (a diff overlay owns Ctrl+F while open)
            if (combo && combo === ui.getShortcut('searchCommits') && !selectedFile.value && !selectedConflict.value) {
                event.preventDefault()
                const target = document.querySelector<HTMLInputElement>('.commit-search input')
                target?.focus()
                target?.select()
                return
            }
            // Push/Pull/Fetch.
            // Skipped while typing (Ctrl+Arrows = word jump), palette open (owns Arrows), or no repo.
            if (!repoStore.commandPaletteOpen && repoStore.repo) {
                const target = event.target as HTMLElement | null
                if (!target?.closest('input, textarea, [contenteditable="true"]')) {
                    if (combo) {
                        if (combo === ui.getShortcut('fetch')) {
                            event.preventDefault()
                            void syncStore.fetch(repoStore.refresh)
                            return
                        }
                        if (combo === ui.getShortcut('push')) {
                            event.preventDefault()
                            void syncStore.push(repoStore.refresh)
                            return
                        }
                        if (combo === ui.getShortcut('pull')) {
                            event.preventDefault()
                            void syncStore.pull(repoStore.refresh)
                            return
                        }
                    }
                }
            }
        }

        onBeforeUnmount(() => {
            if (autoRefreshTimer.value) clearInterval(autoRefreshTimer.value)
            window.removeEventListener('keydown', onKeyDown)
        })
        window.addEventListener('keydown', onKeyDown)

        // Ctrl/Cmd+wheel zooms the app itself (steps of ui.zoom) instead of letting
        // Chromium page-zoom behind the app's own zoom setting
        let wheelAcc = 0
        const onWheelZoom = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            wheelAcc += event.deltaY
            if (Math.abs(wheelAcc) >= 100) {
                ui.stepZoom(wheelAcc < 0 ? 1 : -1)
                wheelAcc = 0
            }
        }
        window.addEventListener('wheel', onWheelZoom, { passive: false })
        onUnmounted(() => window.removeEventListener('wheel', onWheelZoom))
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
            if (resize.side === 'left') ui.sidebarWidth = Math.min(380, Math.max(SIDEBAR_MIN_WIDTH, resize.startWidth + delta))
            else ui.rightPanelWidth = Math.min(500, Math.max(RIGHT_PANEL_MIN_WIDTH, resize.startWidth - delta))
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
            await uiTransient.withBusy(async () => {
                await fn()
                await repoStore.refresh()
            }, busyLabel)
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
        const result = await promptDialog({
            title: 'Create branch',
            message: `New branch at ${commit.shortHash} — ${commit.subject}`,
            placeholder: 'branch name',
            confirmLabel: 'Create',
            existing,
            branchOptions: { checkout: true, localChanges: 'stash' },
        })
        if (result?.name)
            void run(
                `Created branch ${result.name}`,
                () => window.api.createBranch(result.name, result.checkout, commit.hash, result.localChanges),
                `Creating branch ${result.name}…`
            )
    }

    function cherryPickCommit(commit: CommitNode) {
        void (async () => {
            try {
                await uiTransient.withBusy(async () => {
                    await window.api.cherryPick(commit.hash)
                    await repoStore.refresh()
                }, 'Cherry-picking…')
                await notifyUndoable(repoStore.repo?.path, `Cherry-picked ${commit.shortHash}`)
            } catch (error) {
                // Conflicts leave unmerged files behind — refresh so they paint instead of going stale.
                await repoStore.refresh().catch(() => {})
                uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
            }
        })()
    }

    async function revertCommit(commit: CommitNode) {
        const ok = await confirmDialog({
            message: `Revert commit ${commit.shortHash}?`,
            confirmLabel: 'Revert',
        })
        if (!ok) return
        try {
            await uiTransient.withBusy(async () => {
                await window.api.revertCommit(commit.hash)
                await repoStore.refresh()
            }, 'Reverting commit…')
            await notifyUndoable(repoStore.repo?.path, `Reverted ${commit.shortHash}`)
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
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
        try {
            await uiTransient.withBusy(async () => {
                await window.api.resetTo(commit.hash, mode)
                await repoStore.refresh()
            }, `Resetting to ${commit.shortHash}…`)
            void notifyUndoable(repoStore.repo?.path, `Reset to ${commit.shortHash} (${mode})`)
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function closeCommitView() {
        selectedFile.value = null
        selectedCommit.value = null
        selectedStash.value = null
    }
</script>

<template>
    <div
        class="app"
        :style="{
            '--sidebar-width': `${ui.sidebarWidth}px`,
            '--right-panel-width': `${ui.rightPanelWidth}px`,
        }">
        <template v-if="repo">
            <TabBar
                :tabs="tabs"
                :active-index="activeTab"
                :repo="repo"
                :refresh="repoStore.refresh"
                @select="index => repoStore.setActive(index)"
                @close="repoStore.closeTab($event)"
                @reorder="(from, to) => repoStore.reorderTabs(from, to)"
                @create-stash="stashCreateOpen = true"
                @clone="cloneOpen = true" />
            <div class="app-shell">
                <Sidebar
                    :repo="repo"
                    :refresh="repoStore.refresh"
                    @interactive-rebase="rebaseBase = $event" />
                <div
                    class="panel-splitter"
                    @mousedown="event => beginResize('left', event)" />
                <div
                    v-if="repoStore.loadingRepo"
                    class="busy-overlay">
                    <div class="busy-card">
                        <ThinkSpinner suffix="Loading repository…" />
                    </div>
                </div>
                <div class="app-main">
                    <div class="app-body">
                        <div class="center-column">
                            <GraphView
                                :commits="commits"
                                :has-more="hasMore"
                                :commit-open="!!selectedCommit || !!selectedStash"
                                :hide-to-top="!!(selectedFile || selectedConflict || historyFile || blameFile)"
                                @select-commit="selectCommit"
                                @load-more="repoStore.loadMore()"
                                @checkout="checkoutCommit"
                                @create-branch="createBranchAt"
                                @create-tag="tagTarget = $event"
                                @cherry-pick="cherryPickCommit"
                                @squash="squashTarget = $event"
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
                                :files="selectedStash ? repoStore.stashFiles : selectedCommit ? repoStore.commitFiles : repo.files"
                                :mode="selectedStash ? 'stash' : selectedCommit ? 'commit' : 'workdir'"
                                :loading="repoStore.loadingCommitDetails"
                                :commit-hash="selectedStash?.hash ?? selectedCommit?.hash"
                                :selected="selectedFile ?? (selectedConflict ? { path: selectedConflict.path, staged: true } : null)"
                                :commit-message="selectedStash ? selectedStash.message : repoStore.commitMessage"
                                :commit-author="selectedStash ? '' : repoStore.commitAuthor"
                                :commit-date="selectedStash ? selectedStash.date : repoStore.commitDate"
                                :refresh="repoStore.refresh"
                                @select="selectFilePanel"
                                @show-history="historyFile = $event"
                                @show-blame="blameFile = $event"
                                @close-commit="closeCommitView" />
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <div
            v-if="!repo"
            class="app-empty">
            <span class="app-empty-icon">
                <img
                    :src="canoIcon"
                    alt="Git Cano"
                    class="app-empty-logo" />
            </span>
            <strong>No repository opened</strong>
            <div
                v-if="showEmptyWorkspace"
                class="app-empty-workspace">
                <span class="app-empty-workspace-label">Workspace</span>
                <WorkspaceButton />
            </div>
            <OpenRepoMenu
                label="Open repository"
                @clone="cloneOpen = true" />
        </div>
        <ConflictView
            v-if="selectedConflict && repo"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="selectedConflict"
            :refresh="repoStore.refresh"
            @close="selectedConflict = null" />
        <DiffView
            v-if="selectedFile && repo"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="selectedFile"
            :commit-hash="selectedStash ? undefined : (selectedCommit?.hash ?? undefined)"
            :stash-hash="selectedStash?.hash ?? undefined"
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
                    void notifyUndoable(repoStore.repo?.path, message)
                }
            " />
        <FileHistoryModal
            v-if="historyFile"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="historyFile"
            @close="historyFile = null" />
        <BlameModal
            v-if="blameFile"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="blameFile"
            @close="blameFile = null" />
        <TagCreateModal
            v-if="tagTarget"
            :commit="tagTarget"
            @close="tagTarget = null" />
        <SquashModal
            v-if="squashTarget"
            :commit="squashTarget"
            @close="squashTarget = null"
            @complete="squashTarget = null" />
        <StashCreateModal
            v-if="stashCreateOpen"
            @close="stashCreateOpen = false" />
        <CloneRepoModal
            v-if="cloneOpen"
            @close="cloneOpen = false" />
        <ToolsModal
            v-if="toolsOpen"
            :initial-tab="repoStore.toolsTab"
            :refresh="repoStore.refresh"
            @close="toolsOpen = false" />
        <CommandPalette
            v-if="repoStore.commandPaletteOpen"
            @close="repoStore.commandPaletteOpen = false"
            @open-repo="openNewRepo" />
        <ShortcutsModal
            v-if="repoStore.shortcutsOpen"
            @close="repoStore.shortcutsOpen = false" />
        <ErrorDialog
            :message="uiTransient.errorDialog"
            @close="uiTransient.closeErrorDialog()" />
        <div
            v-if="uiTransient.busy"
            class="busy-overlay">
            <div class="busy-card">
                <ThinkSpinner :suffix="uiTransient.busy" />
            </div>
        </div>
        <ConfirmDialog />
        <PromptDialog />
        <SwitchDialog />
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
                        v-if="t.action"
                        class="toast-action"
                        @click="uiTransient.runToastAction(t.id)">
                        <i-lucide-undo-2
                            width="13"
                            height="13" />
                        {{ t.action.label }}
                    </button>
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
                            <!-- X lives in the same SVG as the ring so both stay exactly concentric -->
                            <path
                                class="toast-close-x"
                                d="M14.5 7.5L7.5 14.5M7.5 7.5l7 7" />
                        </svg>
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
                        <img
                            :src="canoIcon"
                            alt="Git Cano"
                            class="splash-logo-image" />
                    </div>
                    <strong class="splash-title">Git Cano</strong>
                    <KittScanner />
                    <span class="splash-muted">{{ splashText }}</span>
                </div>
            </div>
        </Transition>
    </div>
</template>
