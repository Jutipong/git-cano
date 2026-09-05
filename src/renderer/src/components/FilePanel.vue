<script setup lang="ts">
    import { confirmDialog } from '../utils/confirm'
    import { buildTree, flattenTree, type TreeRow } from '../utils/fileTree'
    import { formatDatePattern } from '../utils/format'
    import CloseXIcon from './CloseXIcon.vue'
    import CollapseAllButton from './CollapseAllButton.vue'
    import FileContextMenu, { type FileMenuState } from './FileContextMenu.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { AiCommitMode } from '../stores/ui'
    import type { ToastKind } from '../stores/uiTransient'
    import type { CommitFile, FileEntry } from '@shared/types'

    interface Props {
        files: FileEntry[] | CommitFile[]
        selected: { path: string; staged: boolean } | null
        refresh: () => Promise<unknown>
        mode?: 'workdir' | 'commit' | 'stash'
        loading?: boolean
        commitHash?: string
        commitMessage?: string
        commitAuthor?: string
        commitDate?: string
    }
    const props = withDefaults(defineProps<Props>(), {
        mode: 'workdir',
        loading: false,
        commitHash: '',
        commitMessage: '',
        commitAuthor: '',
        commitDate: '',
    })
    const emit = defineEmits<{
        (e: 'select', sel: { path: string; staged: boolean } | null): void
        (e: 'show-history', path: string): void
        (e: 'show-blame', path: string): void
        (e: 'close-commit'): void
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const uiTransient = useUiTransientStore()
    const pending = ref(false)

    const commitDateText = computed(() =>
        props.commitDate ? formatDatePattern(props.commitDate, ui.commitDateFormat.trim() || 'dd/MM/yyyy HH:mm') : ''
    )

    function copyHash() {
        if (!props.commitHash) return
        navigator.clipboard
            .writeText(props.commitHash)
            .then(() => notify('Hash copied', 'success'))
            .catch(() => notify('Copy failed', 'error'))
    }

    const isWorkdir = computed(() => props.mode === 'workdir')
    const isDetails = computed(() => props.mode !== 'workdir')
    const isUntracked = (file: FileEntry) => file.unstaged === '?'
    const isConflicted = (file: FileEntry) => file.staged === 'U' || file.unstaged === 'U'
    const staged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(
                  file => file.staged !== ' ' && file.staged !== '' && !isConflicted(file) && !isUntracked(file)
              )
            : []
    )
    const untracked = computed(() => (isWorkdir.value ? (props.files as FileEntry[]).filter(isUntracked) : []))
    const unstaged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(file => !isUntracked(file) && (file.staged === ' ' || file.staged === ''))
            : []
    )
    const commitFileList = computed(() => (isWorkdir.value ? [] : (props.files as CommitFile[])))
    const allPaths = ref<string[]>([])
    let allFilesRequest = 0
    const allFiles = computed(() => {
        const paths = new Set(allPaths.value)
        if (isWorkdir.value) {
            const changed = new Map((props.files as FileEntry[]).map(file => [file.path, file]))
            return [...paths].map(path => changed.get(path) ?? { path, staged: '', unstaged: '' })
        }
        const changed = new Map((props.files as CommitFile[]).map(file => [file.path, file]))
        return [...paths].map(path => changed.get(path) ?? { path, status: '', additions: 0, deletions: 0 })
    })
    const commitTotals = computed(() => {
        if (!commitFileList.value.length) return null
        return commitFileList.value.reduce(
            (acc, file) => ({
                additions: acc.additions + file.additions,
                deletions: acc.deletions + file.deletions,
            }),
            { additions: 0, deletions: 0 }
        )
    })
    const ui = useUiStore()
    const ai = useAiStore()
    const commitModelName = computed(() => {
        const models = ai.provider === 'openrouter' ? ai.config.openrouter.models : ai.config.opencodeGo.models
        const selectedModel = models.find(model => model.id === ai.modelId)
        const providerName = ai.provider === 'openrouter' ? 'OpenRouter' : 'OpenCode Go'
        return `${providerName}: ${selectedModel?.name ?? ai.modelId}`
    })
    const AI_MODE_OPTIONS: { value: AiCommitMode; label: string }[] = [
        { value: 'off', label: 'Generate Only' },
        { value: 'commit', label: 'Auto Commit' },
        { value: 'commit-push', label: 'Auto Commit & Push' },
    ]
    const aiModeLabel = (mode: AiCommitMode) => AI_MODE_OPTIONS.find(option => option.value === mode)?.label ?? ''
    const commitModelLabel = computed(() =>
        ui.aiCommitMode === 'off' ? commitModelName.value : `${commitModelName.value} ${aiModeLabel(ui.aiCommitMode)}`
    )
    const aiMenuOpen = ref(false)
    const aiMenuRoot = ref<HTMLElement | null>(null)
    const aiMenuStyle = computed(() => {
        const rect = aiMenuRoot.value?.getBoundingClientRect()
        if (!rect) return {}
        return {
            right: `${Math.max(8, window.innerWidth - rect.right)}px`,
            bottom: `${Math.max(8, window.innerHeight - rect.top + 8)}px`,
        }
    })
    function selectAiMode(mode: AiCommitMode) {
        ui.aiCommitMode = mode
        aiMenuOpen.value = false
    }
    function onAiMenuMouseDown(event: MouseEvent) {
        if (aiMenuOpen.value && aiMenuRoot.value && !aiMenuRoot.value.contains(event.target as Node)) aiMenuOpen.value = false
    }
    function onAiMenuKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') aiMenuOpen.value = false
    }
    onMounted(() => {
        document.addEventListener('mousedown', onAiMenuMouseDown)
        document.addEventListener('keydown', onAiMenuKeyDown)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onAiMenuMouseDown)
        document.removeEventListener('keydown', onAiMenuKeyDown)
    })
    const message = ref('')
    const repoStore = useRepoStore()
    const repoState = computed(() => repoStore.repoState)
    const isMerging = computed(() => repoState.value.merging)
    const isRebasing = computed(() => repoState.value.rebasing)
    const inConflictFlow = computed(() => isMerging.value || isRebasing.value)
    const conflictedFiles = computed(() => (isWorkdir.value ? (props.files as FileEntry[]).filter(isConflicted) : []))

    function markResolved(file: FileEntry) {
        void run(() => window.api.markResolved([file.path]), `${file.path}: resolved`)
    }
    function markAllResolved() {
        const count = conflictedFiles.value.length
        void run(() => window.api.markResolved(conflictedFiles.value.map(file => file.path)), `Marked ${count} files resolved`)
    }
    function continueMerge() {
        void run(() => window.api.continueMerge(), 'Merge completed', 'Completing merge…')
    }
    function abortMerge() {
        void run(() => window.api.abortMerge(), 'Merge aborted', 'Aborting merge…')
    }
    function continueRebase() {
        void run(() => window.api.rebaseContinue(), 'Rebase continued', 'Continuing rebase…')
    }
    function abortRebase() {
        void run(() => window.api.rebaseAbort(), 'Rebase aborted', 'Aborting rebase…')
    }
    watch(
        () => repoStore.repo?.path,
        () => {
            message.value = ''
        }
    )
    const menu = ref<FileMenuState | null>(null)
    const generating = ref(false)
    const generatingRepo = ref<string | null>(null)

    async function cancelGenerate() {
        try {
            await window.api.ai.cancelGenerate(generatingRepo.value ?? undefined)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    const collapsedDirs = reactive(new Set<string>())
    function toggleDir(path: string) {
        if (collapsedDirs.has(path)) collapsedDirs.delete(path)
        else collapsedDirs.add(path)
    }
    /** Every folder that exists in the current file set (including nested ones hidden inside collapsed folders). */
    const allDirPaths = computed(() => {
        const files =
            ui.fileFilterMode === 'all'
                ? allFiles.value
                : isWorkdir.value
                  ? [...staged.value, ...unstaged.value, ...untracked.value]
                  : commitFileList.value
        const dirs = new Set<string>()
        for (const file of files) {
            const parts = file.path.split('/')
            for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
        }
        return [...dirs]
    })
    /** Derived from collapsedDirs so manually collapsed folders stay in sync. */
    const allDirsCollapsed = computed(() => allDirPaths.value.length > 0 && allDirPaths.value.every(path => collapsedDirs.has(path)))
    /** Whole group-header label is clickable only when collapsing actually does something. */
    const canToggleAll = computed(() => ui.fileViewMode === 'tree' && allDirPaths.value.length > 0)
    function toggleAllDirs() {
        if (allDirsCollapsed.value) collapsedDirs.clear()
        else for (const path of allDirPaths.value) collapsedDirs.add(path)
    }
    function toggleViewMode() {
        ui.fileViewMode = ui.fileViewMode === 'tree' ? 'flat' : 'tree'
    }
    async function loadAllFiles() {
        const request = ++allFilesRequest
        const mode = props.mode
        const commitHash = props.commitHash
        const repoPath = repoStore.repo?.path
        if (ui.fileFilterMode !== 'all') {
            allPaths.value = []
            return
        }
        try {
            const paths = await window.api.listFiles(mode !== 'workdir' ? commitHash || undefined : undefined)
            if (
                request !== allFilesRequest ||
                ui.fileFilterMode !== 'all' ||
                props.mode !== mode ||
                props.commitHash !== commitHash ||
                repoStore.repo?.path !== repoPath
            )
                return
            allPaths.value = [...new Set(paths)]
        } catch (error) {
            if (request !== allFilesRequest) return
            allPaths.value = []
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    watch([() => ui.fileFilterMode, () => props.mode, () => props.commitHash, () => repoStore.repo?.path], () => void loadAllFiles(), {
        immediate: true,
    })

    async function refreshPanel() {
        if (pending.value) return
        pending.value = true
        try {
            await props.refresh()
            await loadAllFiles()
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            pending.value = false
        }
    }

    type AnyRow<T> = TreeRow & { file?: T }
    function makeRows<T extends FileEntry | CommitFile>(files: T[], group: string): AnyRow<T>[] {
        if (ui.fileViewMode === 'flat') {
            return files.map(file => ({
                key: `${group}:${file.path}`,
                kind: 'file' as const,
                name: file.path,
                fullPath: file.path,
                depth: 0,
                file,
            }))
        }
        const byPath = new Map(files.map(file => [file.path, file]))
        return flattenTree(buildTree(files.map(file => file.path)), collapsedDirs, `${group}:`).map(row => ({
            ...row,
            file: row.kind === 'file' ? byPath.get(row.fullPath) : undefined,
        }))
    }

    const stagedRows = computed(() => makeRows(staged.value, 'staged'))
    const unstagedRows = computed(() => makeRows([...unstaged.value, ...untracked.value], 'unstaged'))
    const commitRows = computed(() => makeRows(commitFileList.value, 'commit'))
    const allRows = computed(() => makeRows<FileEntry | CommitFile>(allFiles.value, 'all'))

    async function run(fn: () => Promise<unknown>, ok: string | null, busyLabel = 'Working…'): Promise<boolean> {
        if (pending.value) return false
        pending.value = true
        try {
            await uiTransient.withBusy(async () => {
                await fn()
                await props.refresh()
                await loadAllFiles()
            }, busyLabel)
            if (ok) notify(ok, 'success')
            return true
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
            return false
        } finally {
            pending.value = false
        }
    }

    async function doCommit(push = false) {
        if (!message.value.trim()) {
            notify('Enter a commit message first', 'warning')
            return
        }
        const text = message.value.trim()
        const ok = await run(
            async () => {
                await window.api.commitWithAmend(text, false)
                if (push) await window.api.push()
            },
            push ? 'Committed and pushed successfully' : 'Committed successfully',
            push ? 'Committing and pushing…' : 'Committing…'
        )
        if (ok) message.value = ''
    }

    const canGenerate = computed(
        () =>
            isWorkdir.value &&
            props.files.length > 0 &&
            ai.configured &&
            !pending.value &&
            !generating.value &&
            // A merge/rebase conflict has no committable state — the panel shows the
            // conflict actions instead, and the palette path shares this gate.
            !inConflictFlow.value
    )

    const showAiGroup = computed(() => ai.configured)

    async function generateMessage() {
        if (generating.value) return
        aiMenuOpen.value = false
        // Pin the repo for the whole flow: generation takes seconds (formatter +
        // model round-trip), and every follow-up step must target this repo even if
        // the user switches tabs meanwhile — never the newly activated one.
        const repoPath = repoStore.repo?.path
        if (!repoPath) {
            notify('No repository opened', 'warning')
            return
        }
        generating.value = true
        generatingRepo.value = repoPath
        try {
            const scope = ui.aiCommitMode === 'off' ? 'staged' : 'all'
            const generated = (
                await uiTransient.withBusy(
                    () => window.api.ai.generateCommitMessage(ui.formatBeforeGenerate, scope, repoPath),
                    'Generating commit message…'
                )
            ).trim()
            // Switched tabs mid-flight: the message describes the pinned repo, so it
            // must not land in another repo's box — and auto-commit must not run at all.
            if (repoStore.repo?.path !== repoPath) {
                notify('Repository changed during generation — message discarded', 'warning')
                return
            }
            message.value = generated
            if (generated && ui.aiCommitMode !== 'off') {
                const mode = ui.aiCommitMode
                const ok = await run(
                    async () => {
                        await window.api.stageAll(repoPath)
                        await window.api.commitWithAmend(generated, false, repoPath)
                        if (mode === 'commit-push') await window.api.push(false, repoPath)
                    },
                    mode === 'commit-push' ? 'Committed and pushed successfully' : 'Committed successfully'
                )
                if (ok) message.value = ''
            }
        } catch (error) {
            const msg = String(error).replace(/^Error:\s*/, '')
            // Cancellation is intentional — a warning toast, never the error dialog.
            if (/cancel/i.test(msg)) notify('Generation cancelled', 'warning')
            else notify(msg, 'error')
        } finally {
            generating.value = false
            generatingRepo.value = null
        }
    }

    // Command palette one-shot AI run: temporarily switch the AI mode, run the existing
    // generateMessage() flow, then restore the user's own aiCommitMode setting.
    watch(
        () => ui.aiRunRequest,
        async request => {
            if (!request) return
            ui.aiRunRequest = null
            if (!canGenerate.value) {
                notify('AI commit is unavailable right now', 'warning')
                return
            }
            const previousMode = ui.aiCommitMode
            ui.aiCommitMode = request
            try {
                await generateMessage()
            } finally {
                ui.aiCommitMode = previousMode
            }
        }
    )

    const committing = computed(() => pending.value)

    function startResizeBox(event: MouseEvent) {
        event.preventDefault()
        const startY = event.clientY
        const startH = ui.summaryHeight
        const onMove = (moveEvent: MouseEvent) => {
            ui.summaryHeight = Math.min(480, Math.max(140, startH + (startY - moveEvent.clientY)))
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

    function openFileMenu(event: MouseEvent, path: string, file?: FileEntry | CommitFile) {
        if (isWorkdir.value && file && !hasWorkdirStatus(file as FileEntry)) return
        menu.value = {
            x: event.clientX,
            y: event.clientY,
            path,
            untracked: isWorkdir.value && file ? isUntracked(file as FileEntry) : false,
            deleted: !isWorkdir.value && !!file && unifiedCommitFile(file).status === 'D',
        }
    }
    function openDirectoryMenu(event: MouseEvent, path: string) {
        menu.value = { x: event.clientX, y: event.clientY, path, directory: true }
    }

    const STATUS_LABEL: Record<string, string> = {
        M: 'Modified',
        A: 'Added',
        D: 'Deleted',
        '?': 'Untracked',
        R: 'Renamed',
        C: 'Copied',
        U: 'Conflict',
    }
    function unstage(file: FileEntry) {
        void run(() => window.api.unstage([file.path]), null)
    }
    function stage(file: FileEntry) {
        void run(() => window.api.stage([file.path]), null)
    }
    function unstageAll() {
        void run(() => window.api.unstageAll(), null)
    }
    function stageAll() {
        void run(() => window.api.stageAll(), null)
    }
    async function discard(file: FileEntry) {
        const untrackedFile = isUntracked(file)
        const ok = await confirmDialog({
            title: untrackedFile ? 'Delete untracked file' : 'Discard changes',
            message: untrackedFile
                ? `"${file.path}" is not in git history and will be permanently deleted.`
                : `Discard all uncommitted changes to "${file.path}"? This cannot be undone.`,
            confirmLabel: untrackedFile ? 'Delete' : 'Discard',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.discardFile(file.path), untrackedFile ? 'File deleted' : 'Changes discarded')
    }
    async function discardUnstagedAll() {
        const ok = await confirmDialog({
            title: 'Discard unstaged changes',
            message: 'All unstaged changes to tracked files will be lost. Staged changes are kept.',
            confirmLabel: 'Discard',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.discardUnstaged(), 'Unstaged changes discarded')
    }

    function badgeClass(badge: string) {
        const status = badge === '?' ? 'A' : badge === 'R' || badge === 'C' ? 'M' : badge
        return `b-${status.toLowerCase()}`
    }
    function badgeText(badge: string) {
        return badge === '?' ? 'A' : badge
    }

    function hasStatus(status: string) {
        return status !== '' && status !== ' '
    }
    function hasWorkdirStatus(file: FileEntry) {
        return hasStatus(file.staged) || hasStatus(file.unstaged)
    }
    function unifiedWorkdirFile(file: FileEntry | CommitFile) {
        return file as FileEntry
    }
    function unifiedCommitFile(file: FileEntry | CommitFile) {
        return file as CommitFile
    }
    function unifiedStatus(file: FileEntry | CommitFile) {
        if (!isWorkdir.value) return unifiedCommitFile(file).status
        const workdirFile = unifiedWorkdirFile(file)
        if (isUntracked(workdirFile)) return '?'
        return hasStatus(workdirFile.staged) ? workdirFile.staged : hasStatus(workdirFile.unstaged) ? workdirFile.unstaged : ''
    }
    function unifiedStaged(file: FileEntry | CommitFile) {
        return isWorkdir.value && !isUntracked(unifiedWorkdirFile(file)) && hasStatus(unifiedWorkdirFile(file).staged)
    }
    function unifiedUnstaged(file: FileEntry | CommitFile) {
        return isWorkdir.value && hasStatus(unifiedWorkdirFile(file).unstaged)
    }

    const firstLine = computed(() => message.value.split('\n')[0] ?? '')
    const subjectCountClass = computed(() => (firstLine.value.length > 72 ? 'over' : firstLine.value.length > 50 ? 'warn' : ''))
</script>

<template>
    <div
        class="file-panel"
        :class="{ 'commit-mode': isDetails }">
        <div
            class="panel-heading"
            :class="{ 'commit-mode': isDetails }">
            <div class="panel-heading-title">
                <i-icon-park-outline-change
                    v-if="isDetails"
                    width="16"
                    height="16" />
                <i-lucide-file-diff
                    v-else
                    width="16"
                    height="16" /><strong>{{ isDetails ? (mode === 'stash' ? 'Stash Changes' : 'Committed History') : 'Changes' }}</strong>
            </div>
            <div class="panel-heading-side">
                <div class="file-view-controls">
                    <button
                        class="file-mode-btn"
                        :title="ui.fileViewMode === 'tree' ? 'Show as flat list' : 'Show as tree'"
                        @click="toggleViewMode()">
                        <i-lucide-list
                            v-if="ui.fileViewMode === 'tree'"
                            width="15"
                            height="15" />
                        <i-lucide-folder-tree
                            v-else
                            width="15"
                            height="15" />
                    </button>
                    <span class="file-controls-divider" />
                    <button
                        class="file-mode-btn file-scope-btn"
                        :class="{ active: ui.fileFilterMode === 'all' }"
                        :title="ui.fileFilterMode === 'all' ? 'Show changed files' : 'View all files'"
                        :aria-label="ui.fileFilterMode === 'all' ? 'Show changed files' : 'View all files'"
                        @click="ui.fileFilterMode = ui.fileFilterMode === 'all' ? 'changed' : 'all'">
                        <i-lucide-list-tree
                            width="15"
                            height="15" />
                    </button>
                    <template v-if="mode === 'workdir'">
                        <span class="file-controls-divider" />
                        <button
                            class="file-mode-btn refresh-btn"
                            title="Refresh changes"
                            :disabled="pending"
                            @click="refreshPanel()">
                            <i-lucide-refresh-cw
                                :class="{ spinning: pending }"
                                width="15"
                                height="15" />
                        </button>
                    </template>
                    <template v-if="isDetails">
                        <span class="file-controls-divider" />
                        <button
                            class="commit-close-btn file-mode-btn"
                            title="Close details (show working directory)"
                            @click="emit('close-commit')">
                            <CloseXIcon />
                        </button>
                    </template>
                </div>
            </div>
        </div>

        <div class="file-groups">
            <div
                v-if="loading"
                class="diff-loading">
                <div class="busy-card">
                    <ThinkSpinner suffix="Loading files…" />
                </div>
            </div>
            <template v-else-if="ui.fileFilterMode === 'all'">
                <div class="group-header">
                    <h4
                        :class="{ 'can-toggle': canToggleAll }"
                        @click="canToggleAll && toggleAllDirs()">
                        <CollapseAllButton
                            v-if="canToggleAll"
                            :all-collapsed="allDirsCollapsed"
                            @toggle="toggleAllDirs()" />
                        All files <span>{{ allFiles.length }}</span>
                    </h4>
                </div>
                <template
                    v-for="row in allRows"
                    :key="row.key">
                    <div
                        v-if="row.kind === 'dir'"
                        class="dir-row"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="toggleDir(row.fullPath)"
                        @contextmenu.prevent="openDirectoryMenu($event, row.fullPath)">
                        <i-lucide-chevron-right
                            v-if="collapsedDirs.has(row.fullPath)"
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-chevron-down
                            v-else
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-folder
                            class="dir-icon"
                            width="14"
                            height="14" />
                        <span
                            class="file-path dir-name"
                            :title="row.fullPath"
                            >{{ row.name }}</span
                        >
                        <span class="dir-count">{{ row.count }}</span>
                    </div>
                    <div
                        v-else
                        class="file-row"
                        :class="{ selected: selected?.path === row.fullPath }"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="emit('select', { path: row.fullPath, staged: unifiedStaged(row.file!) })"
                        @contextmenu.prevent="openFileMenu($event, row.fullPath, row.file!)">
                        <span
                            v-if="unifiedStatus(row.file!)"
                            class="badge"
                            :class="badgeClass(unifiedStatus(row.file!))"
                            >{{ badgeText(unifiedStatus(row.file!)) }}</span
                        >
                        <span
                            v-else
                            class="file-status-spacer" />
                        <span
                            class="file-path"
                            :class="{ 'file-deleted': unifiedStatus(row.file!) === 'D' }"
                            :title="row.fullPath"
                            >{{ row.name }}</span
                        >
                        <template v-if="isWorkdir">
                            <div
                                v-if="isConflicted(unifiedWorkdirFile(row.file!))"
                                class="conflict-row-actions">
                                <button
                                    class="detail-action accent"
                                    title="I resolved this file outside the app — stage it as resolved"
                                    @click.stop="markResolved(unifiedWorkdirFile(row.file!))">
                                    <i-lucide-check
                                        width="12"
                                        height="12" />
                                    Resolved
                                </button>
                            </div>
                            <template v-else>
                                <button
                                    v-if="unifiedStaged(row.file!)"
                                    class="icon-btn"
                                    title="Unstage"
                                    @click.stop="unstage(unifiedWorkdirFile(row.file!))">
                                    <i-lucide-minus
                                        width="14"
                                        height="14" />
                                </button>
                                <button
                                    v-if="unifiedUnstaged(row.file!) || isUntracked(unifiedWorkdirFile(row.file!))"
                                    class="icon-btn"
                                    title="Stage"
                                    @click.stop="stage(unifiedWorkdirFile(row.file!))">
                                    <i-lucide-plus
                                        width="14"
                                        height="14" />
                                </button>
                                <button
                                    v-if="unifiedUnstaged(row.file!) || isUntracked(unifiedWorkdirFile(row.file!))"
                                    class="icon-btn danger"
                                    title="Discard changes"
                                    @click.stop="discard(unifiedWorkdirFile(row.file!))">
                                    <i-lucide-rotate-ccw
                                        width="13"
                                        height="13" />
                                </button>
                            </template>
                        </template>
                        <span
                            v-else-if="unifiedCommitFile(row.file!).additions || unifiedCommitFile(row.file!).deletions"
                            class="commit-file-stats">
                            <span
                                v-if="unifiedCommitFile(row.file!).additions"
                                class="stat-add"
                                >+{{ unifiedCommitFile(row.file!).additions.toLocaleString() }}</span
                            >
                            <span
                                v-if="unifiedCommitFile(row.file!).deletions"
                                class="stat-del"
                                >−{{ unifiedCommitFile(row.file!).deletions.toLocaleString() }}</span
                            >
                        </span>
                    </div>
                </template>
                <div
                    v-if="allRows.length === 0"
                    class="group-empty">
                    No files
                </div>
            </template>

            <template v-else-if="mode === 'workdir'">
                <template v-if="conflictedFiles.length > 0">
                    <div class="group-header">
                        <h4>
                            Conflicted files <span>{{ conflictedFiles.length }}</span>
                        </h4>
                        <div class="group-header-actions">
                            <button
                                class="link-btn warn"
                                title="Mark every remaining conflicted file as resolved (for files fixed outside the app)"
                                @click="markAllResolved()">
                                Mark all resolved
                            </button>
                        </div>
                    </div>
                    <div
                        v-for="file in conflictedFiles"
                        :key="file.path"
                        class="file-row"
                        :class="{ selected: selected?.path === file.path }"
                        :title="`${file.path} — click to resolve conflicts`"
                        @click="emit('select', { path: file.path, staged: true })"
                        @contextmenu.prevent="openFileMenu($event, file.path, file)">
                        <span class="badge b-u">U</span>
                        <span
                            class="file-path"
                            :title="`${file.path} — Conflict`"
                            >{{ file.path }}</span
                        >
                        <div class="conflict-row-actions">
                            <button
                                class="detail-action accent"
                                title="I resolved this file outside the app — stage it as resolved"
                                @click.stop="markResolved(file)">
                                <i-lucide-check
                                    width="12"
                                    height="12" />
                                Resolved
                            </button>
                        </div>
                    </div>
                </template>

                <template v-if="staged.length > 0">
                    <div class="group-header">
                        <h4
                            :class="{ 'can-toggle': canToggleAll }"
                            @click="canToggleAll && toggleAllDirs()">
                            <CollapseAllButton
                                v-if="canToggleAll"
                                :all-collapsed="allDirsCollapsed"
                                @toggle="toggleAllDirs()" />
                            {{ isMerging ? 'Resolved files' : 'Staged files' }} <span>{{ staged.length }}</span>
                        </h4>
                        <div class="group-header-actions">
                            <button
                                class="link-btn warn"
                                @click="unstageAll()">
                                Unstage all
                            </button>
                        </div>
                    </div>
                    <template
                        v-for="row in stagedRows"
                        :key="row.key">
                        <div
                            v-if="row.kind === 'dir'"
                            class="dir-row"
                            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                            @click="toggleDir(row.fullPath)"
                            @contextmenu.prevent="openDirectoryMenu($event, row.fullPath)">
                            <i-lucide-chevron-right
                                v-if="collapsedDirs.has(row.fullPath)"
                                class="dir-chevron"
                                width="13"
                                height="13" />
                            <i-lucide-chevron-down
                                v-else
                                class="dir-chevron"
                                width="13"
                                height="13" />
                            <i-lucide-folder
                                class="dir-icon"
                                width="14"
                                height="14" />
                            <span
                                class="file-path dir-name"
                                :title="row.fullPath"
                                >{{ row.name }}</span
                            >
                            <span class="dir-count">{{ row.count }}</span>
                        </div>
                        <div
                            v-else
                            class="file-row"
                            :class="{ selected: selected?.path === row.fullPath && selected.staged }"
                            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                            @click="emit('select', { path: row.fullPath, staged: true })"
                            @contextmenu.prevent="openFileMenu($event, row.fullPath, row.file!)">
                            <span
                                class="badge"
                                :class="badgeClass(row.file!.staged)"
                                >{{ row.file!.staged }}</span
                            >
                            <span
                                class="file-path"
                                :class="{ 'file-deleted': row.file!.staged === 'D' }"
                                :title="`${row.fullPath} — ${STATUS_LABEL[row.file!.staged] ?? ''}`"
                                >{{ row.name }}</span
                            >
                            <button
                                class="icon-btn"
                                title="Unstage"
                                @click.stop="unstage(row.file!)">
                                <i-lucide-minus
                                    width="14"
                                    height="14" />
                            </button>
                        </div>
                    </template>
                </template>

                <div class="group-header">
                    <h4
                        :class="{ 'can-toggle': canToggleAll }"
                        @click="canToggleAll && toggleAllDirs()">
                        <CollapseAllButton
                            v-if="canToggleAll"
                            :all-collapsed="allDirsCollapsed"
                            @toggle="toggleAllDirs()" />
                        Unstaged <span>{{ unstaged.length + untracked.length }}</span>
                    </h4>
                    <div class="group-header-actions">
                        <button
                            v-if="unstaged.length > 0"
                            class="link-btn danger"
                            title="Discard all unstaged changes (staged changes are kept)"
                            @click="discardUnstagedAll()">
                            Discard all
                        </button>
                        <button
                            v-if="unstaged.length > 0 || untracked.length > 0"
                            class="link-btn good"
                            title="Stage all changes (including untracked files)"
                            @click="stageAll()">
                            Stage all
                        </button>
                    </div>
                </div>
                <template
                    v-for="row in unstagedRows"
                    :key="row.key">
                    <div
                        v-if="row.kind === 'dir'"
                        class="dir-row"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="toggleDir(row.fullPath)"
                        @contextmenu.prevent="openDirectoryMenu($event, row.fullPath)">
                        <i-lucide-chevron-right
                            v-if="collapsedDirs.has(row.fullPath)"
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-chevron-down
                            v-else
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-folder
                            class="dir-icon"
                            width="14"
                            height="14" />
                        <span
                            class="file-path dir-name"
                            :title="row.fullPath"
                            >{{ row.name }}</span
                        >
                        <span class="dir-count">{{ row.count }}</span>
                    </div>
                    <div
                        v-else
                        class="file-row"
                        :class="{ selected: selected?.path === row.fullPath && !selected.staged }"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="emit('select', { path: row.fullPath, staged: false })"
                        @contextmenu.prevent="openFileMenu($event, row.fullPath, row.file!)">
                        <span
                            class="badge"
                            :class="badgeClass(row.file!.unstaged)"
                            >{{ badgeText(row.file!.unstaged) }}</span
                        >
                        <span
                            class="file-path"
                            :class="{ 'file-deleted': row.file!.unstaged === 'D' }"
                            :title="`${row.fullPath} — ${STATUS_LABEL[row.file!.unstaged] ?? ''}`"
                            >{{ row.name }}</span
                        >
                        <button
                            class="icon-btn"
                            title="Stage"
                            @click.stop="stage(row.file!)">
                            <i-lucide-plus
                                width="14"
                                height="14" />
                        </button>
                        <button
                            class="icon-btn danger"
                            :title="isUntracked(row.file!) ? 'Discard (deletes the file)' : 'Discard changes'"
                            @click.stop="discard(row.file!)">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                        </button>
                    </div>
                </template>
                <div
                    v-if="unstaged.length === 0 && untracked.length === 0"
                    class="group-empty">
                    {{ files.length === 0 ? 'Working tree clean' : 'No unstaged changes' }}
                </div>
            </template>

            <template v-else>
                <div class="group-header">
                    <h4
                        :class="{ 'can-toggle': canToggleAll }"
                        @click="canToggleAll && toggleAllDirs()">
                        <CollapseAllButton
                            v-if="canToggleAll"
                            :all-collapsed="allDirsCollapsed"
                            @toggle="toggleAllDirs()" />
                        Changed files <span>{{ commitFileList.length }}</span>
                    </h4>
                    <span
                        v-if="commitTotals && (commitTotals.additions || commitTotals.deletions)"
                        class="commit-file-stats">
                        <span
                            v-if="commitTotals.additions"
                            class="stat-add"
                            >+{{ commitTotals.additions.toLocaleString() }}</span
                        >
                        <span
                            v-if="commitTotals.deletions"
                            class="stat-del"
                            >−{{ commitTotals.deletions.toLocaleString() }}</span
                        >
                    </span>
                </div>
                <template
                    v-for="row in commitRows"
                    :key="row.key">
                    <div
                        v-if="row.kind === 'dir'"
                        class="dir-row"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="toggleDir(row.fullPath)"
                        @contextmenu.prevent="openDirectoryMenu($event, row.fullPath)">
                        <i-lucide-chevron-right
                            v-if="collapsedDirs.has(row.fullPath)"
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-chevron-down
                            v-else
                            class="dir-chevron"
                            width="13"
                            height="13" />
                        <i-lucide-folder
                            class="dir-icon"
                            width="14"
                            height="14" />
                        <span
                            class="file-path dir-name"
                            :title="row.fullPath"
                            >{{ row.name }}</span
                        >
                        <span class="dir-count">{{ row.count }}</span>
                    </div>
                    <div
                        v-else
                        class="commit-file-block">
                        <div
                            class="file-row"
                            :class="{ selected: selected?.path === row.fullPath }"
                            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                            @click="emit('select', { path: row.fullPath, staged: false })"
                            @contextmenu.prevent="openFileMenu($event, row.fullPath, row.file!)">
                            <span
                                class="badge"
                                :class="badgeClass(row.file!.status)"
                                >{{ row.file!.status }}</span
                            >
                            <span
                                class="file-path"
                                :class="{ 'file-deleted': row.file!.status === 'D' }"
                                :title="row.fullPath"
                                >{{ row.name }}</span
                            >
                            <span class="commit-file-stats">
                                <span
                                    v-if="row.file!.additions"
                                    class="stat-add"
                                    >+{{ row.file!.additions.toLocaleString() }}</span
                                >
                                <span
                                    v-if="row.file!.deletions"
                                    class="stat-del"
                                    >−{{ row.file!.deletions.toLocaleString() }}</span
                                >
                            </span>
                        </div>
                    </div>
                </template>
                <div
                    v-if="commitFileList.length === 0"
                    class="group-empty">
                    No changed files
                </div>
            </template>

            <FileContextMenu
                :menu="menu"
                :refresh="refreshPanel"
                @close="menu = null"
                @show-history="path => emit('show-history', path)"
                @show-blame="path => emit('show-blame', path)" />
        </div>

        <div class="commit-box">
            <div
                v-if="isWorkdir && inConflictFlow"
                class="merge-actions">
                <button
                    class="btn conflict-continue"
                    :disabled="conflictedFiles.length > 0 || pending"
                    :title="conflictedFiles.length ? 'Resolve all conflicts first' : ''"
                    @click="isRebasing ? continueRebase() : continueMerge()">
                    <ThinkSpinner
                        v-if="pending"
                        compact />
                    <i-lucide-check
                        v-else
                        width="14"
                        height="14" />
                    {{ pending ? (isRebasing ? 'Continuing…' : 'Merging…') : isRebasing ? 'Continue rebase' : 'Continue merge' }}
                </button>
                <button
                    class="btn conflict-abort"
                    :disabled="pending"
                    @click="isRebasing ? abortRebase() : abortMerge()">
                    <i-lucide-x
                        width="14"
                        height="14" />
                    {{ isRebasing ? 'Abort rebase' : 'Abort merge' }}
                </button>
            </div>
            <template v-else>
                <div
                    class="cb-resize-handle"
                    title="Drag to resize"
                    @mousedown="startResizeBox" />
                <div
                    v-if="mode === 'workdir'"
                    class="cb-toolbar">
                    <span class="commit-box-label">
                        <i-mage-message-dots
                            width="12"
                            height="12" />
                        Message
                    </span>
                    <span
                        v-if="message"
                        :class="['subject-count', subjectCountClass]">
                        Title {{ firstLine.length }} / 72
                    </span>
                </div>
                <div
                    v-if="isDetails && (commitAuthor || commitDate)"
                    class="readonly-meta-row">
                    <span class="readonly-meta readonly-meta-start">
                        {{ [commitAuthor, commitDateText].filter(Boolean).join(' · ') }}
                    </span>
                    <button
                        v-if="commitHash"
                        class="readonly-meta readonly-meta-end"
                        type="button"
                        title="Copy commit hash"
                        @click="copyHash">
                        <i-lucide-copy
                            width="10"
                            height="10" />
                        {{ commitHash.slice(0, 7) }}
                    </button>
                </div>
                <textarea
                    v-if="isDetails"
                    :value="commitMessage"
                    :style="{ height: `${ui.summaryHeight}px` }"
                    placeholder="No commit message"
                    readonly />
                <textarea
                    v-else
                    v-model="message"
                    :style="{ height: `${ui.summaryHeight}px` }"
                    placeholder="Summary of changes"
                    @keydown.enter.meta.prevent="doCommit()"
                    @keydown.enter.ctrl.prevent="doCommit()" />
                <div
                    v-if="mode === 'workdir' && showAiGroup"
                    class="summary-counter">
                    <span
                        v-if="showAiGroup"
                        class="counter-model"
                        :title="`Commit-message model: ${commitModelLabel}`">
                        <span class="counter-model-main">
                            <i-streamline-flex-color-artificial-intelligence-brain-chip-flat
                                width="14"
                                height="14" />
                            <span class="counter-model-name">{{ commitModelName }}</span>
                        </span>
                        <span
                            v-if="ui.aiCommitMode !== 'off'"
                            class="counter-mode-detail">
                            <i-fluent-emoji-flat-robot
                                width="14"
                                height="14" />
                            <span
                                class="counter-mode-label"
                                :class="`cb-ai-mode-${ui.aiCommitMode}`"
                                >{{ aiModeLabel(ui.aiCommitMode) }}</span
                            >
                        </span>
                    </span>
                </div>
                <div
                    v-if="mode === 'workdir'"
                    class="commit-actions">
                    <div class="commit-group">
                        <button
                            class="btn primary commit-btn"
                            :disabled="pending || !message.trim() || staged.length === 0"
                            title="Commit staged changes"
                            @click="doCommit(false)">
                            <ThinkSpinner
                                v-if="committing"
                                compact />
                            <i-lucide-check
                                v-else
                                width="14"
                                height="14" />
                            {{ committing ? 'Committing…' : 'Commit' }}
                        </button>
                        <span class="tab-actions-sep" />
                        <button
                            class="btn commit-push-btn"
                            :disabled="pending || !message.trim() || staged.length === 0"
                            title="Commit staged changes and push to remote"
                            @click="doCommit(true)">
                            <ThinkSpinner
                                v-if="committing"
                                compact />
                            <i-lucide-arrow-up
                                v-else
                                width="14"
                                height="14" />
                            {{ committing ? 'Committing…' : 'Commit & Push' }}
                        </button>
                    </div>
                    <div
                        v-if="showAiGroup"
                        ref="aiMenuRoot"
                        class="cb-ai-group cb-group-item"
                        :class="[`cb-ai-mode-${ui.aiCommitMode}`, { 'cb-ai-open': aiMenuOpen, 'cb-ai-disabled': !canGenerate && !generating }]">
                        <button
                            class="btn small cb-ai-btn"
                            :disabled="!canGenerate && !generating"
                            :title="
                                generating
                                    ? 'Cancel generation'
                                    : ui.aiCommitMode === 'commit-push'
                                      ? 'Generate a commit message, commit and push'
                                      : ui.aiCommitMode === 'commit'
                                        ? 'Generate a commit message and commit automatically'
                                        : 'Generate a commit message from the current changes'
                            "
                            @click="generating ? cancelGenerate() : generateMessage()">
                            <ThinkSpinner
                                v-if="generating"
                                compact />
                            <i-fluent-emoji-flat-robot
                                v-else
                                width="18"
                                height="18" />
                        </button>
                        <button
                            class="cb-ai-caret"
                            title="Choose auto-commit behavior"
                            aria-haspopup="listbox"
                            :aria-expanded="aiMenuOpen"
                            @click.stop="aiMenuOpen = !aiMenuOpen">
                            <i-lucide-chevron-down
                                width="12"
                                height="12" />
                        </button>
                        <div
                            v-if="aiMenuOpen"
                            class="cb-ai-menu"
                            :class="`cb-ai-mode-${ui.aiCommitMode}`"
                            :style="aiMenuStyle"
                            role="listbox"
                            aria-label="AI auto-commit behavior">
                            <button
                                v-for="option in AI_MODE_OPTIONS"
                                :key="option.value"
                                class="cb-ai-menu-item"
                                :class="{ active: ui.aiCommitMode === option.value }"
                                role="option"
                                :aria-selected="ui.aiCommitMode === option.value"
                                @click="selectAiMode(option.value)">
                                <i-lucide-check
                                    v-if="ui.aiCommitMode === option.value"
                                    width="13"
                                    height="13" />
                                <span
                                    v-else
                                    class="cb-ai-menu-bullet" />
                                {{ option.label }}
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
