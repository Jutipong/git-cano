<script setup lang="ts">
    import { storeToRefs } from 'pinia'
    import { computed, onBeforeUnmount, onMounted, onUnmounted, provide, ref, watch } from 'vue'
    import ILucideArchive from '~icons/lucide/archive'
    import ILucideArrowDown from '~icons/lucide/arrow-down'
    import ILucideArrowDownToLine from '~icons/lucide/arrow-down-to-line'
    import ILucideArrowUp from '~icons/lucide/arrow-up'
    import ILucideUndo2 from '~icons/lucide/undo-2'

    import canoIcon from './assets/cano.svg'
    import BlameModal from './components/BlameModal.vue'
    import FilePreviewModal from './components/FilePreviewModal.vue'
    import ChangelogModal from './components/ChangelogModal.vue'
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
    import ReflogModal from './components/ReflogModal.vue'
    import ShortcutsModal from './components/ShortcutsModal.vue'
    import Sidebar from './components/Sidebar.vue'
    import SquashModal from './components/SquashModal.vue'
    import StashCreateModal from './components/StashCreateModal.vue'
    import SwitchDialog from './components/SwitchDialog.vue'
    import TabBar from './components/TabBar.vue'
    import TagCreateModal from './components/TagCreateModal.vue'
    import TerminalPanel from './components/TerminalPanel.vue'
    import ThinkSpinner from './components/ThinkSpinner.vue'
    import ToolsModal from './components/ToolsModal.vue'
    import WorkspaceButton from './components/WorkspaceButton.vue'
    import { useAiStore } from './stores/ai'
    import { useAuthStore } from './stores/auth'
    import { useRepoStore } from './stores/repo'
    import { useSyncStore } from './stores/sync'
    import { MAX_TERMINALS_PER_REPO, useTerminalStore } from './stores/terminal'
    import { DEFAULT_ZOOM, useUiStore } from './stores/ui'
    import { useUiTransientStore, type NotifyOptions, type ToastKind } from './stores/uiTransient'
    import { useUpdaterStore } from './stores/updater'
    import { useWorkspaceStore } from './stores/workspace'
    import { confirmDialog } from './utils/confirm'
    import { useMinVisible } from './utils/minVisible'
    import { promptDialog } from './utils/prompt'
    import { eventToCombo } from './utils/shortcuts'
    import { SPLASH_MIN_MS } from './utils/splash'
    import { notifyUndoable } from './utils/undo'

    import type { CommitNode, RepoStatus } from '@shared/types'

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const auth = useAuthStore()
    const wsStore = useWorkspaceStore()
    const syncStore = useSyncStore()
    const updater = useUpdaterStore()
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
        previewFile,
        toolsOpen,
        booted,
        switchingWorkspace,
    } = storeToRefs(repoStore)
    const repo = computed(() => repoStore.repo)

    const terminalStore = useTerminalStore()
    /**
     * Every repo path that owns at least one shell — each gets its OWN TerminalPanel instance (keyed
     * by path) so its xterm buffers + pty stay alive while another tab is active, while a workspace
     * switch happens, or while the panel is toggled away — hiding only stops painting, and killing is
     * the ✕ buttons' job alone. The list comes from the terminal store itself, NOT from the open repo
     * tabs: a workspace switch empties `tabs`, and panels keyed off it would unmount and throw away
     * the buffers of shells that are still running.
     */
    const terminalPaths = computed(() => Object.keys(terminalStore.terminals))
    /** Path of the repo whose terminal is on screen (the active tab). */
    const activeRepoPath = computed(() => repo?.value?.path ?? null)
    /** True while this repo's panel is the one on screen (active tab, not toggled away). */
    function isTerminalVisible(path: string): boolean {
        return path === activeRepoPath.value && terminalStore.panelVisible(path)
    }
    /** True only for the active repo's terminal while it is expanded. */
    function isExpandedTerminal(path: string): boolean {
        return terminalStore.isExpanded(path) && path === activeRepoPath.value
    }

    /** Whole seconds left on a toast, shown as the countdown badge on its close button. */
    function countdownSeconds(t: { progress: number; durationMs: number }) {
        return Math.ceil((t.progress * t.durationMs) / 1000)
    }

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
    const tagTarget = ref<{ hash: string | null; subject?: string | null; shortHash?: string | null; branchName?: string | null } | null>(null)
    const squashTarget = ref<CommitNode | null>(null)
    const stashCreateOpen = ref(false)
    const cloneOpen = ref(false)

    // Splash visibility is stabilized by the shared composable: the boot cover stays for the shared
    // minimum after `booted` flips, and the switch cover for the minimum after `switchingWorkspace`
    // clears — `switchWorkspace` itself no longer waits.
    const bootSplashVisible = useMinVisible(() => !booted.value, { minVisibleMs: SPLASH_MIN_MS })
    const switchSplashVisible = useMinVisible(() => switchingWorkspace.value, { minVisibleMs: SPLASH_MIN_MS })
    const splashVisible = computed(() => bootSplashVisible.value || switchSplashVisible.value)
    const splashText = computed(() => (switchSplashVisible.value ? 'Switching workspace…' : 'Restoring your repositories…'))

    // Cached tab switches finish before the delay, so they never flash the "Loading repository…" overlay.
    const loadingRepoVisible = useMinVisible(() => repoStore.loadingRepo, { showDelayMs: 150, minVisibleMs: 400 })
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

        // Silent update check: first run 30s after launch, then every updateCheckHours.
        // 0 = manual only. Only flips the shared updater state — the sidebar button
        // appears solely when a newer release is found.
        let updateTimer: ReturnType<typeof setTimeout> | null = null
        let updateInterval: ReturnType<typeof setInterval> | null = null
        function clearUpdateTimers() {
            if (updateTimer) {
                clearTimeout(updateTimer)
                updateTimer = null
            }
            if (updateInterval) {
                clearInterval(updateInterval)
                updateInterval = null
            }
        }
        function startUpdateSchedule() {
            clearUpdateTimers()
            const hours = ui.updateCheckHours
            if (!hours || hours <= 0) return
            updateTimer = setTimeout(() => {
                updateTimer = null
                void updater.checkForUpdate()
            }, 30 * 1000)
            updateInterval = setInterval(() => void updater.checkForUpdate(), hours * 60 * 60 * 1000)
        }
        startUpdateSchedule()
        watch(() => ui.updateCheckHours, startUpdateSchedule)
        onUnmounted(clearUpdateTimers)

        // First launch after an update: the app version no longer matches the one we saw last time.
        // A blank lastSeenVersion is a fresh install, not an update — never show the changelog then.
        void window.api
            .getVersion()
            .then(current => {
                if (ui.lastSeenVersion && ui.lastSeenVersion !== current) updater.changelogOpen = true
                ui.lastSeenVersion = current
            })
            .catch(() => {})

        // Window menu → What's new
        onUnmounted(window.api.onChangelogOpen(() => (updater.changelogOpen = true)))

        // double-Shift detection for the command palette (two taps within the window)
        const DOUBLE_SHIFT_MS = 400
        let lastShiftTap = 0

        /**
         * App-level shortcuts: open repo, clone, settings, palette, terminal toggle/kill-all and
         * commit-search focus. Returns true when it handled the combo (and preventDefault()s it).
         *
         * This runs twice on purpose. xterm stops propagation of character keys, so a focused shell
         * would otherwise swallow Ctrl+P / Ctrl+, / Ctrl+O entirely — the capture-phase listener
         * below grabs them first and stops the event there, which also keeps the bubble-phase copy
         * from firing a second time. Combos the shell owns (Ctrl+Arrows, Escape, …) are deliberately
         * NOT here: they stay in the bubble handler so TUIs and readline keep receiving them.
         */
        function handleAppShortcut(combo: string | null, event: KeyboardEvent): boolean {
            if (!combo) return false
            if (combo === ui.getShortcut('openRepo')) {
                event.preventDefault()
                openNewRepo()
                return true
            }
            if (combo === ui.getShortcut('cloneRepo')) {
                event.preventDefault()
                cloneOpen.value = true
                return true
            }
            if (combo === ui.getShortcut('settings')) {
                event.preventDefault()
                repoStore.toolsOpen = true
                return true
            }
            // Command palette (double-Shift is handled above, in the bubble handler)
            if (combo === ui.getShortcut('commandPalette')) {
                event.preventDefault()
                repoStore.commandPaletteOpen = !repoStore.commandPaletteOpen
                return true
            }
            // Terminal panel: spawn the first shell of the active repo, then show/hide. Never kills.
            // Killing every shell is palette-only (confirm-guarded) — no shortcut, too easy to fat-finger.
            if (combo === ui.getShortcut('terminal') && repoStore.repo) {
                event.preventDefault()
                void toggleTerminal()
                return true
            }
            // Focus commit-history search (a diff overlay owns Ctrl+F while open, so leave it alone)
            if (combo === ui.getShortcut('searchCommits') && !selectedFile.value && !selectedConflict.value) {
                event.preventDefault()
                const target = document.querySelector<HTMLInputElement>('.commit-search input')
                target?.focus()
                target?.select()
                return true
            }
            return false
        }

        /**
         * The same shortcuts one phase earlier, so they also reach the app while a shell has focus.
         * Stopping propagation keeps the bubble-phase handler from handling them a second time and
         * stops the shell from seeing a key the user bound to the app.
         */
        const onKeyDownCapture = (event: KeyboardEvent) => {
            if (uiTransient.busy) return
            if (event.metaKey || event.ctrlKey) {
                if (handleAppShortcut(eventToCombo(event), event)) event.stopPropagation()
            }
        }

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
                // Close active repo tab — fixed, works everywhere (even while typing).
                if (eventToCombo(event) === 'Ctrl+W') {
                    event.preventDefault()
                    if (tabs.value.length > 0) void repoStore.closeTab(activeTab.value)
                    return
                }
            }
            if (uiTransient.busy) return
            if (event.key === 'Escape') {
                if (historyFile.value || blameFile.value || previewFile.value) return
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

            // App shortcuts (the capture-phase twin of this handler sees them first — see onKeyDownCapture).
            if (handleAppShortcut(combo, event)) return
            // Push/Pull/Fetch.
            // Skipped while typing (Ctrl+Arrows = word jump), palette open (owns Arrows), or no repo.
            if (!repoStore.commandPaletteOpen && repoStore.repo) {
                const target = event.target as HTMLElement | null
                if (!target?.closest('input, textarea, [contenteditable="true"]')) {
                    if (combo) {
                        if (combo === ui.getShortcut('fetch')) {
                            event.preventDefault()
                            void syncStore.fetch(repoStore.refreshWithTags)
                            return
                        }
                        if (combo === ui.getShortcut('push')) {
                            event.preventDefault()
                            void syncStore.push(repoStore.refresh)
                            return
                        }
                        if (combo === ui.getShortcut('pull')) {
                            event.preventDefault()
                            void syncStore.pull(repoStore.refreshWithTags)
                            return
                        }
                    }
                }
            }
        }

        onBeforeUnmount(() => {
            if (autoRefreshTimer.value) clearInterval(autoRefreshTimer.value)
            window.removeEventListener('keydown', onKeyDownCapture, true)
            window.removeEventListener('keydown', onKeyDown)
        })
        window.addEventListener('keydown', onKeyDownCapture, true)
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
    /** Vertical drag for the bottom terminal panel — pulls the top edge, so delta grows downward. */
    function beginTerminalResize(event: MouseEvent) {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = terminalStore.terminalHeight
        const maxHeight = Math.max(160, Math.round(window.innerHeight * 0.7))
        const onMove = (moveEvent: MouseEvent) => {
            const delta = startY - moveEvent.clientY
            terminalStore.terminalHeight = Math.min(maxHeight, Math.max(120, startHeight + delta))
        }
        const onEnd = () => {
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onEnd)
        }
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onEnd)
    }

    /** Ask to close every shell of one repo — they all die, so this always confirms. */
    async function confirmCloseTerminal(path: string): Promise<void> {
        const count = terminalStore.terminalCount(path)
        if (!count) return
        const ok = await confirmDialog({
            title: count > 1 ? `Close ${count} terminals` : 'Close terminal',
            message:
                count > 1
                    ? `Closing these ${count} terminals will end their shell sessions and clear their scrollback.`
                    : 'Closing the terminal will end its shell session and clear its scrollback.',
            confirmLabel: count > 1 ? `Close ${count} terminals` : 'Close terminal',
            danger: true,
        })
        if (ok) await terminalStore.closeRepoTerminals(path)
    }

    /** Ask to close one terminal tab — its shell and scrollback die, so this always confirms. */
    async function confirmCloseTerminalTab(path: string, id: string): Promise<void> {
        const label = terminalStore.tabLabel(path, id)
        if (!label) return
        const ok = await confirmDialog({
            title: `Close ${label}`,
            message: 'Closing this terminal will end its shell session and clear its scrollback.',
            confirmLabel: 'Close terminal',
            danger: true,
        })
        if (ok) terminalStore.closeTerminalTab(path, id)
    }

    /** Panel `+` — spawn another shell for this repo, up to the per-repo cap. */
    async function addTerminalTab(path: string) {
        if (!(await terminalStore.openTerminalTab(path))) {
            uiTransient.notify(`Maximum ${MAX_TERMINALS_PER_REPO} terminals per repo`, 'warning')
        }
    }

    /**
     * The graph toolbar button / Ctrl+` / palette "Terminal": spawn the first shell when the repo has
     * none, otherwise show or hide the panel. It never kills anything — the ✕ buttons own that.
     */
    async function toggleTerminal() {
        const path = repoStore.tabs[repoStore.activeTab]?.path
        if (!path) return
        if (terminalStore.terminalExists(path)) {
            if (terminalStore.panelVisible(path)) terminalStore.hideTerminals(path)
            else terminalStore.showTerminals(path)
            return
        }
        const available = await window.api.terminalAvailable().catch(() => false)
        if (!available) {
            uiTransient.notify('Terminal is unavailable — the native module could not be loaded', 'error')
            return
        }
        await terminalStore.openTerminalTab(path)
    }

    /**
     * Kill every shell of every repository — the palette command and its shortcut. Confirm first: it
     * ends shells of repos that are not even on screen.
     */
    async function killAllTerminals() {
        const total = Object.values(terminalStore.terminals).reduce((sum, state) => sum + state.tabs.length, 0)
        if (!total) {
            uiTransient.notify('No terminals are running', 'info')
            return
        }
        const ok = await confirmDialog({
            title: `Kill ${total} terminal${total > 1 ? 's' : ''}`,
            message: 'Every running shell will end, including those of repositories that are not on screen.',
            confirmLabel: 'Kill all',
            danger: true,
        })
        if (!ok) return
        const killed = await terminalStore.killAllTerminals()
        uiTransient.notify(`Killed ${killed} terminal${killed === 1 ? '' : 's'}`, 'success')
    }

    /**
     * One shell ended on its own (exit / Ctrl+D / crash) — drop just that tab, exactly like a manual
     * close but without the confirm: the process is already gone, so there is nothing to end. When it
     * was the repo's last terminal the panel unmounts with it.
     */
    function handleTerminalExit(path: string, id: string) {
        terminalStore.closeTerminalTab(path, id)
    }

    /** Expand the terminal over the whole center column (graph hidden) or restore its height. */
    function toggleTerminalExpand(path: string) {
        terminalStore.setExpanded(path, !terminalStore.isExpanded(path))
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
            chip: commit.shortHash,
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

    async function showUncommittedChanges(count: number) {
        const manage = await confirmDialog({
            title: 'Uncommitted changes',
            message: `This action requires a clean working tree. Stash or commit ${count} changed file(s), then try again.`,
            status: { kind: 'warn', text: `${count} file(s) have uncommitted changes` },
            confirmLabel: 'Create stash',
        })
        if (manage) stashCreateOpen.value = true
    }

    async function cherryPickOnto(hash: string, targetBranch: string) {
        if (uiTransient.busy) return
        const short = hash.slice(0, 7)
        let current: RepoStatus
        try {
            current = await window.api.status()
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
            return
        }
        if (current.files.length > 0) {
            await showUncommittedChanges(current.files.length)
            return
        }

        const currentTarget = current.branch === 'HEAD (detached)' ? 'HEAD' : current.branch
        const switching = targetBranch !== currentTarget
        let status: { kind: 'ok' | 'warn' | 'unknown'; text: string }
        let willConflict = false
        try {
            const check = await uiTransient.withBusy(
                () => window.api.cherryPickCheck(hash, targetBranch),
                `Checking cherry-pick onto ${targetBranch}…`
            )
            willConflict = check.conflicts.length > 0
            status = !check.supported
                ? { kind: 'unknown', text: 'Conflict check unavailable' }
                : check.fastForward
                  ? { kind: 'warn', text: 'Already in this branch — pick would come out empty' }
                  : willConflict
                    ? { kind: 'warn', text: `Cherry-pick will cause conflicts — ${check.conflicts.length} file(s)` }
                    : { kind: 'ok', text: 'Can be picked without conflicts' }
        } catch {
            status = { kind: 'unknown', text: 'Conflict check unavailable' }
        }
        const ok = await confirmDialog({
            title: 'Cherry-pick commit',
            message: switching
                ? willConflict
                    ? `Will checkout "${targetBranch}" to resolve conflicts.`
                    : `Will checkout "${targetBranch}" first, then pick ${short} onto it.`
                : `Pick ${short} onto "${targetBranch}"?`,
            flow: { from: short, to: targetBranch, label: 'cherry-pick' },
            status,
            confirmLabel: 'Cherry-pick',
        })
        if (!ok) return
        try {
            await uiTransient.withBusy(async () => {
                if (switching) await window.api.checkout(targetBranch, 'keep')
                await window.api.cherryPick(hash)
                await repoStore.refresh()
            }, `Cherry-picking onto ${targetBranch}…`)
            await notifyUndoable(current.path, `Cherry-picked ${short} onto ${targetBranch}`)
        } catch (error) {
            // A conflict leaves unmerged files behind — refresh anyway so they paint instead of going stale.
            await repoStore.refresh().catch(() => {})
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function cherryPickCommit(commit: CommitNode) {
        const current = repoStore.repo?.branch
        if (!current) return
        void cherryPickOnto(commit.hash, current === 'HEAD (detached)' ? 'HEAD' : current)
    }

    async function mergeBranchOnto(source: string, targetBranch: string) {
        if (uiTransient.busy) return
        let current: RepoStatus
        try {
            current = await window.api.status()
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
            return
        }
        if (current.files.length > 0) {
            await showUncommittedChanges(current.files.length)
            return
        }

        let status: { kind: 'ok' | 'warn' | 'unknown'; text: string }
        let willConflict = false
        try {
            const check = await uiTransient.withBusy(
                () => window.api.mergeCheckConflicts(source, targetBranch),
                `Checking merge of ${source} into ${targetBranch}…`
            )
            willConflict = check.conflicts.length > 0
            status = !check.supported
                ? { kind: 'unknown', text: 'Conflict check unavailable (git too old)' }
                : willConflict
                  ? { kind: 'warn', text: `Merge will cause conflicts — ${check.conflicts.length} file(s)` }
                  : check.fastForward
                    ? { kind: 'ok', text: 'Fast-forward — no conflicts possible' }
                    : { kind: 'ok', text: 'Merge can be done without conflicts' }
        } catch {
            status = { kind: 'unknown', text: 'Conflict check unavailable' }
        }
        const ok = await confirmDialog({
            title: 'Merge branch',
            message: willConflict
                ? `Will checkout "${targetBranch}" to resolve conflicts.`
                : 'Merges without switching your current branch.',
            flow: { from: source, to: targetBranch },
            status,
            confirmLabel: 'Merge',
        })
        if (!ok) return
        try {
            await uiTransient.withBusy(async () => {
                await window.api.mergeInto(source, targetBranch)
                await repoStore.refresh()
            }, `Merging ${source} into ${targetBranch}…`)
            await notifyUndoable(current.path, `Merged ${source} into ${targetBranch}`)
        } catch (error) {
            await repoStore.refresh().catch(() => {})
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
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
        <!--
            The app shell also stays mounted while a workspace switch is in flight
            (`switchingWorkspace`): `switchWorkspace` empties `tabs` before it reopens the destination,
            so `repo` goes null mid-switch, and `v-if="repo"` alone would unmount this whole subtree —
            throwing away the Changes panel's commit-message draft and the graph's scroll position.
            `v-show` hides it instead, so only the empty state is on screen for that gap.
        -->
        <template v-if="repo || switchingWorkspace">
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
            <div
                v-show="!!repo"
                class="app-shell">
                <Sidebar
                    v-if="repo"
                    :repo="repo"
                    :refresh="repoStore.refresh"
                    @interactive-rebase="rebaseBase = $event"
                    @cherry-pick="cherryPickOnto"
                    @merge-branch="mergeBranchOnto"
                    @create-tag="tagTarget = $event" />
                <div
                    class="panel-splitter"
                    @mousedown="event => beginResize('left', event)" />
                <div
                    v-if="loadingRepoVisible"
                    class="busy-overlay">
                    <div class="busy-card">
                        <ThinkSpinner suffix="Loading repository…" />
                    </div>
                </div>
                <div class="app-main">
                    <div class="app-body">
                        <div class="center-column">
                            <GraphView
                                v-show="!isExpandedTerminal(activeRepoPath ?? '')"
                                :commits="commits"
                                :has-more="hasMore"
                                :commit-open="!!selectedCommit || !!selectedStash"
                                :hide-to-top="!!(selectedFile || selectedConflict || historyFile || blameFile || previewFile)"
                                @select-commit="selectCommit"
                                @load-more="repoStore.loadMore()"
                                @checkout="checkoutCommit"
                                @create-branch="createBranchAt"
                                @create-tag="tagTarget = $event"
                                @cherry-pick="cherryPickCommit"
                                @squash="squashTarget = $event"
                                @revert="revertCommit"
                                @reset-soft="commit => resetTo(commit, 'soft')"
                                @reset-hard="commit => resetTo(commit, 'hard')"
                                @toggle-terminal="toggleTerminal" />
                            <div
                                v-if="activeRepoPath && terminalStore.panelVisible(activeRepoPath) && !terminalStore.isExpanded(activeRepoPath)"
                                class="terminal-splitter"
                                @mousedown="beginTerminalResize" />
                            <!--
                                One panel per repo that owns a shell, kept mounted for the whole session:
                                hidden repos keep their xterm buffers and pty alive across repo switches,
                                workspace switches and the panel toggle. Expanded panels teleport into
                                `.app` so they float over the graph without moving the repo tab bar.
                            -->
                            <template
                                v-for="path in terminalPaths"
                                :key="path">
                                <Teleport
                                    to=".app"
                                    :disabled="!isExpandedTerminal(path)">
                                    <TerminalPanel
                                        v-show="isTerminalVisible(path)"
                                        :repo-path="path"
                                        :expanded="isExpandedTerminal(path)"
                                        :visible="isTerminalVisible(path)"
                                        :class="{ 'terminal-overlay': isExpandedTerminal(path) }"
                                        :style="
                                            isExpandedTerminal(path)
                                                ? { right: `${ui.rightPanelWidth + 12}px` }
                                                : { height: `${terminalStore.terminalHeight}px` }
                                        "
                                        @add-tab="addTerminalTab(path)"
                                        @close="confirmCloseTerminal(path)"
                                        @close-tab="id => confirmCloseTerminalTab(path, id)"
                                        @exit="id => handleTerminalExit(path, id)"
                                        @toggle-expand="toggleTerminalExpand(path)"
                                        @hide="terminalStore.hideTerminals(path)" />
                                </Teleport>
                            </template>
                        </div>
                        <div
                            class="panel-splitter"
                            @mousedown="event => beginResize('right', event)" />
                        <div
                            class="right-pane"
                            :style="{ width: `${ui.rightPanelWidth}px`, flexBasis: `${ui.rightPanelWidth}px` }">
                            <FilePanel
                                :files="selectedStash ? repoStore.stashFiles : selectedCommit ? repoStore.commitFiles : (repo?.files ?? [])"
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
                                @show-preview="previewFile = $event"
                                @close-commit="closeCommitView" />
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <div
            v-if="!repo && !switchingWorkspace"
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
            @close="selectedFile = null"
            @show-preview="previewFile = $event" />
        <RebaseEditor
            v-if="rebaseBase"
            :base-ref="rebaseBase"
            @cancel="rebaseBase = null"
            @done="
                message => {
                    rebaseBase = null
                    void repoStore.refresh()
                    void notifyUndoable(repoStore.repo?.path, message)
                }
            "
            @paused="
                message => {
                    rebaseBase = null
                    void repoStore.refresh()
                    uiTransient.notify(message, 'warning')
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
        <FilePreviewModal
            v-if="previewFile"
            class="diff-overlay"
            :style="{ right: `${ui.rightPanelWidth + 14}px` }"
            :file="previewFile"
            :commit-hash="selectedStash ? undefined : (selectedCommit?.hash ?? undefined)"
            :stash-hash="selectedStash?.hash ?? undefined"
            @close="previewFile = null" />
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
        <ReflogModal
            v-if="repoStore.reflogOpen"
            @close="repoStore.reflogOpen = false" />
        <CommandPalette
            v-if="repoStore.commandPaletteOpen"
            @close="repoStore.commandPaletteOpen = false"
            @open-repo="openNewRepo"
            @toggle-terminal="toggleTerminal"
            @kill-all-terminals="killAllTerminals" />
        <ChangelogModal
            v-if="updater.changelogOpen"
            @close="updater.changelogOpen = false" />
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
                    role="status"
                    @mouseenter="uiTransient.pauseToast(t.id)"
                    @mouseleave="uiTransient.resumeToast(t.id)">
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
                            <!-- Countdown digit lives in the same SVG as the ring so both share one coordinate system -->
                            <Transition
                                name="toast-count"
                                mode="out-in">
                                <text
                                    :key="countdownSeconds(t)"
                                    class="toast-close-count"
                                    x="11"
                                    y="11"
                                    text-anchor="middle"
                                    dominant-baseline="central">
                                    {{ countdownSeconds(t) }}
                                </text>
                            </Transition>
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
