<script setup lang="ts">
    import { formatDatePattern } from '../utils/format'
    import { buildTree, flattenTree, type TreeRow } from '../utils/fileTree'
    import { confirmDialog } from '../utils/confirm'
    import FileContextMenu, { type FileMenuState } from './FileContextMenu.vue'

    import type { CommitFile, FileEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'
    import type { AiCommitMode } from '../stores/ui'

    import { modelName } from '@shared/models'

    interface Props {
        files: FileEntry[] | CommitFile[]
        selected: { path: string; staged: boolean } | null
        refresh: () => Promise<unknown>
        mode?: 'workdir' | 'commit'
        commitHash?: string
        commitMessage?: string
        commitAuthor?: string
        commitDate?: string
    }
    const props = withDefaults(defineProps<Props>(), {
        mode: 'workdir',
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
    const isUntracked = (file: FileEntry) => file.unstaged === '?'
    const staged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(
                  file => file.staged !== ' ' && file.staged !== '' && !isUntracked(file)
              )
            : []
    )
    const untracked = computed(() => (isWorkdir.value ? (props.files as FileEntry[]).filter(isUntracked) : []))
    const unstaged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(
                  file => !isUntracked(file) && (file.staged === ' ' || file.staged === '')
              )
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
    const fileCount = computed(() =>
        ui.fileFilterMode === 'all'
            ? allFiles.value.length
            : isWorkdir.value
              ? new Set((props.files as FileEntry[]).map(file => file.path)).size
              : (props.files as CommitFile[]).length
    )
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
        return `${providerName}: ${selectedModel?.name ?? modelName(ai.modelId)}`
    })
    const AI_MODE_OPTIONS: { value: AiCommitMode; label: string }[] = [
        { value: 'off', label: 'Generate only' },
        { value: 'commit', label: 'auto commit' },
        { value: 'commit-push', label: 'auto commit + push' },
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
    watch(
        () => repoStore.repo?.path,
        () => {
            message.value = ''
        }
    )
    const menu = ref<FileMenuState | null>(null)
    const generating = ref(false)

    const collapsedDirs = reactive(new Set<string>())
    function toggleDir(path: string) {
        if (collapsedDirs.has(path)) collapsedDirs.delete(path)
        else collapsedDirs.add(path)
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
            const paths = await window.api.listFiles(mode === 'commit' ? commitHash || undefined : undefined)
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

    watch(
        [() => ui.fileFilterMode, () => props.mode, () => props.commitHash, () => repoStore.repo?.path],
        () => void loadAllFiles(),
        { immediate: true }
    )

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
        return flattenTree(buildTree(files.map(file => file.path)), collapsedDirs, `${group}:`).map(
            row => ({ ...row, file: row.kind === 'file' ? byPath.get(row.fullPath) : undefined })
        )
    }

    const stagedRows = computed(() => makeRows(staged.value, 'staged'))
    const unstagedRows = computed(() => makeRows(unstaged.value, 'unstaged'))
    const untrackedRows = computed(() => makeRows(untracked.value, 'untracked'))
    const commitRows = computed(() => makeRows(commitFileList.value, 'commit'))
    const allRows = computed(() => makeRows<FileEntry | CommitFile>(allFiles.value, 'all'))

    async function run(fn: () => Promise<unknown>, ok: string | null, busyLabel = 'Working…'): Promise<boolean> {
        if (pending.value) return false
        pending.value = true
        try {
            await uiTransient.withBusy(fn, busyLabel)
            await props.refresh()
            await loadAllFiles()
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
        () => isWorkdir.value && props.files.length > 0 && ai.configured && !pending.value && !generating.value
    )

    const showAiGroup = computed(() => ai.configured)

    async function generateMessage() {
        if (generating.value) return
        aiMenuOpen.value = false
        generating.value = true
        try {
            const generated = (await uiTransient.withBusy(() => window.api.ai.generateCommitMessage(), 'Generating commit message…')).trim()
            message.value = generated
            if (generated && ui.aiCommitMode !== 'off') {
                const mode = ui.aiCommitMode
                const ok = await run(
                    async () => {
                        await window.api.stageAll()
                        await window.api.commitWithAmend(generated, false)
                        if (mode === 'commit-push') await window.api.push()
                    },
                    mode === 'commit-push' ? 'Committed and pushed successfully' : 'Committed successfully'
                )
                if (ok) message.value = ''
            }
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            generating.value = false
        }
    }

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

    function openFileMenu(event: MouseEvent, path: string, file?: FileEntry) {
        if (!isWorkdir.value) return
        if (file && !hasWorkdirStatus(file)) return
        menu.value = {
            x: event.clientX,
            y: event.clientY,
            path,
            untracked: file ? isUntracked(file) : false,
        }
    }
    function openDirectoryMenu(event: MouseEvent, path: string) {
        if (!isWorkdir.value) return
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
    async function discardUntrackedAll() {
        const ok = await confirmDialog({
            title: 'Delete untracked files',
            message: `All ${untracked.value.length} untracked files will be permanently deleted.`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.discardUntracked(), 'Untracked files deleted')
    }

    function badgeClass(badge: string) {
        const status = badge === '?' || badge === 'R' || badge === 'C' ? 'M' : badge
        return `b-${status.toLowerCase()}`
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
    const subjectCountClass = computed(() =>
        firstLine.value.length > 72 ? 'over' : firstLine.value.length > 50 ? 'warn' : ''
    )
</script>

<template>
    <div class="file-panel">
        <div
            class="panel-heading"
            :class="{ 'commit-mode': mode === 'commit' }">
            <div class="panel-heading-title">
                <button
                    v-if="mode === 'commit'"
                    class="icon-btn danger commit-close-btn"
                    title="Close commit details (show working directory)"
                    @click="emit('close-commit')">
                    <i-lucide-x
                        width="14"
                        height="14" />
                </button>
                <i-lucide-file-diff
                    v-else
                    width="16"
                    height="16" /><strong>{{ mode === 'commit' ? 'Commit Changes' : 'Changes' }}</strong>
                <span class="panel-file-num">{{ fileCount }}</span>
            </div>
            <div class="panel-heading-side">
                <span
                    v-if="mode === 'commit' && commitTotals && (commitTotals.additions || commitTotals.deletions)"
                    class="commit-file-stats">
                    <span
                        v-if="commitTotals.additions"
                        class="stat-add">+{{ commitTotals.additions.toLocaleString() }}</span
                    >
                    <span
                        v-if="commitTotals.deletions"
                        class="stat-del">−{{ commitTotals.deletions.toLocaleString() }}</span
                    >
                </span>
                <button
                    v-if="mode === 'workdir'"
                    class="view-toggle refresh-btn"
                    title="Refresh changes"
                    :disabled="pending"
                    @click="refreshPanel()">
                    <i-lucide-refresh-cw
                        :class="{ spinning: pending }"
                        width="14"
                        height="14" />
                </button>
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
                </div>
            </div>
        </div>

        <div class="file-groups">
            <template v-if="ui.fileFilterMode === 'all'">
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
                        :title="row.fullPath">{{ row.name }}</span>
                    <span class="dir-count">{{ row.count }}</span>
                </div>
                <div
                    v-else
                    class="file-row"
                    :class="{ selected: selected?.path === row.fullPath }"
                    :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                    @click="emit('select', { path: row.fullPath, staged: unifiedStaged(row.file!) })"
                    @contextmenu.prevent="openFileMenu($event, row.fullPath, isWorkdir ? unifiedWorkdirFile(row.file!) : undefined)">
                    <span
                        v-if="unifiedStatus(row.file!)"
                        class="badge"
                        :class="badgeClass(unifiedStatus(row.file!))">{{ unifiedStatus(row.file!) }}</span>
                    <span
                        v-else
                        class="file-status-spacer" />
                    <span
                        class="file-path"
                        :title="row.fullPath">{{ row.name }}</span>
                    <template v-if="isWorkdir">
                        <button
                            v-if="unifiedStaged(row.file!)"
                            class="icon-btn"
                            title="Unstage"
                            @click.stop="unstage(unifiedWorkdirFile(row.file!))">
                            <i-lucide-minus width="14" height="14" />
                        </button>
                        <button
                            v-if="unifiedUnstaged(row.file!) || isUntracked(unifiedWorkdirFile(row.file!))"
                            class="icon-btn"
                            title="Stage"
                            @click.stop="stage(unifiedWorkdirFile(row.file!))">
                            <i-lucide-plus width="14" height="14" />
                        </button>
                        <button
                            v-if="unifiedUnstaged(row.file!) || isUntracked(unifiedWorkdirFile(row.file!))"
                            class="icon-btn danger"
                            title="Discard changes"
                            @click.stop="discard(unifiedWorkdirFile(row.file!))">
                            <i-lucide-rotate-ccw width="13" height="13" />
                        </button>
                    </template>
                    <span
                        v-else-if="unifiedCommitFile(row.file!).additions || unifiedCommitFile(row.file!).deletions"
                        class="commit-file-stats">
                        <span
                            v-if="unifiedCommitFile(row.file!).additions"
                            class="stat-add">+{{ unifiedCommitFile(row.file!).additions.toLocaleString() }}</span>
                        <span
                            v-if="unifiedCommitFile(row.file!).deletions"
                            class="stat-del">−{{ unifiedCommitFile(row.file!).deletions.toLocaleString() }}</span>
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
            <div class="group-header">
                <h4>
                    Staged files <span>{{ staged.length }}</span>
                </h4>
                <div class="group-header-actions">
                    <button
                        v-if="staged.length > 0"
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
                        :title="row.fullPath">{{ row.name }}</span>
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
            <div
                v-if="staged.length === 0"
                class="group-empty">
                No staged files
            </div>

            <div class="group-header">
                <h4>
                    Unstaged changes <span>{{ unstaged.length }}</span>
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
                        :title="row.fullPath">{{ row.name }}</span>
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
                        >{{ row.file!.unstaged }}</span
                    >
                    <span
                        class="file-path"
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
                        title="Discard changes"
                        @click.stop="discard(row.file!)">
                        <i-lucide-rotate-ccw
                            width="13"
                            height="13" />
                    </button>
                </div>
            </template>
            <div
                v-if="unstaged.length === 0"
                class="group-empty">
                {{ files.length === 0 ? 'Working tree clean' : 'No unstaged changes' }}
            </div>

            <template v-if="untracked.length > 0">
            <div class="group-header">
                <h4>
                    Untracked <span>{{ untracked.length }}</span>
                </h4>
                <div class="group-header-actions">
                    <button
                        class="link-btn danger"
                        title="Delete all untracked files (they are not in git history and cannot be recovered)"
                        @click="discardUntrackedAll()">
                        Discard
                    </button>
                </div>
            </div>
            <template
                v-for="row in untrackedRows"
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
                        :title="row.fullPath">{{ row.name }}</span>
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
                        :class="badgeClass('?')"
                        >?</span
                    >
                    <span
                        class="file-path"
                        title="Untracked — not part of git history yet"
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
                        title="Discard (deletes the file)"
                        @click.stop="discard(row.file!)">
                        <i-lucide-rotate-ccw
                            width="13"
                            height="13" />
                    </button>
                </div>
            </template>
            </template>
            </template>

            <template v-else>
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
                            :title="row.fullPath">{{ row.name }}</span>
                        <span class="dir-count">{{ row.count }}</span>
                    </div>
                    <div
                        v-else
                        class="commit-file-block">
                        <div
                            class="file-row"
                            :class="{ selected: selected?.path === row.fullPath }"
                            :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                            @click="emit('select', { path: row.fullPath, staged: false })">
                            <span
                                class="badge"
                                :class="badgeClass(row.file!.status)"
                                >{{ row.file!.status }}</span
                            >
                            <span
                                class="file-path"
                                :title="row.fullPath"
                                >{{ row.name }}</span
                            >
                            <span class="commit-file-stats">
                                <span
                                    v-if="row.file!.additions"
                                    class="stat-add">+{{ row.file!.additions.toLocaleString() }}</span
                                >
                                <span
                                    v-if="row.file!.deletions"
                                    class="stat-del">−{{ row.file!.deletions.toLocaleString() }}</span
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
                v-if="mode === 'commit' && (commitAuthor || commitDate)"
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
                v-if="mode === 'commit'"
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
                            :class="`cb-ai-mode-${ui.aiCommitMode}`">{{ aiModeLabel(ui.aiCommitMode) }}</span>
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
                        {{ committing ? 'Committing…' : 'Commit' }}
                    </button>
                    <button
                        class="btn commit-push-btn"
                        :disabled="pending || !message.trim() || staged.length === 0"
                        title="Commit staged changes and push to remote"
                        @click="doCommit(true)">
                        {{ committing ? 'Committing…' : 'Commit + push' }}
                    </button>
                </div>
                <div
                    v-if="showAiGroup"
                    ref="aiMenuRoot"
                    class="cb-ai-group cb-group-item"
                    :class="[
                        `cb-ai-mode-${ui.aiCommitMode}`,
                        { 'cb-ai-open': aiMenuOpen, 'cb-ai-disabled': !canGenerate },
                    ]">
                    <button
                        class="btn small cb-ai-btn"
                        :disabled="!canGenerate"
                        :title="
                            ui.aiCommitMode === 'commit-push'
                                ? 'Generate a commit message, commit and push'
                                : ui.aiCommitMode === 'commit'
                                  ? 'Generate a commit message and commit automatically'
                                  : 'Generate a commit message from the current changes'
                        "
                        @click="generateMessage()">
                        <i-lucide-loader-circle
                            v-if="generating"
                            class="spinning"
                            width="16"
                            height="16" />
                        <i-fluent-emoji-flat-robot
                            v-else
                            width="18"
                            height="18" />
                    </button>
                    <button
                        class="cb-ai-caret"
                        :disabled="!canGenerate"
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
                            <span v-else class="cb-ai-menu-bullet" />
                            {{ option.label }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
