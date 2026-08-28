<script setup lang="ts">
    import { formatCommitDate } from '../utils/format'
    import { buildTree, flattenTree, type TreeRow } from '../utils/fileTree'
    import { confirmDialog } from '../utils/confirm'

    import type { CommitFile, FileEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

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
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const pending = ref(false)

    const isWorkdir = computed(() => props.mode === 'workdir')
    // untracked files arrive as index='?' (mapped to 'A' in the store) + working_dir='?'.
    // they must NOT count as staged, otherwise they can never leave the Staged group
    // after "Unstage all" (git reset makes newly-added files untracked again)
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
    // human-readable label for the commit-message model (falls back to the raw id)
    const commitModelName = computed(() => modelName(ai.modelId))
    const message = ref('')
    const menu = ref<{ x: number; y: number; path: string } | null>(null)
    const generating = ref(false)

    // tree view state (collapse dirs; shared across groups so the same folder stays folded)
    const collapsedDirs = reactive(new Set<string>())
    function toggleDir(path: string) {
        if (collapsedDirs.has(path)) collapsedDirs.delete(path)
        else collapsedDirs.add(path)
    }
    function toggleViewMode() {
        ui.fileViewMode = ui.fileViewMode === 'tree' ? 'flat' : 'tree'
    }

    async function refreshPanel() {
        if (pending.value) return
        pending.value = true
        try {
            await props.refresh()
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
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

    async function run(fn: () => Promise<unknown>, ok: string | null) {
        if (pending.value) return
        pending.value = true
        try {
            await fn()
            await props.refresh()
            if (ok) notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        } finally {
            pending.value = false
        }
    }

    async function doCommit() {
        if (!message.value.trim()) return notify('Enter a commit message first')
        await run(
            () => window.api.commitWithAmend(message.value.trim(), false),
            'Committed successfully'
        )
        message.value = ''
    }

    /** Disabled until an OpenCode token + model are configured (Settings → ai)
     * and there are changes to summarize (staging is NOT required). */
    const canGenerate = computed(
        () => isWorkdir.value && props.files.length > 0 && ai.configured && !pending.value && !generating.value
    )

    /** AI workflow group shows once a token + model-id are configured. */
    const showAiGroup = computed(() => ai.configured)

    async function generateMessage() {
        if (generating.value) return
        generating.value = true
        try {
            const generated = (await window.api.ai.generateCommitMessage()).trim()
            message.value = generated
            if (ui.autoCommit && generated) {
                await run(
                    async () => {
                        await window.api.stageAll()
                        await window.api.commitWithAmend(generated, false)
                    },
                    'Committed successfully'
                )
                message.value = ''
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
            // ลากขึ้น = สูงขึ้น
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

    function pickHistory(path: string) {
        emit('show-history', path)
        menu.value = null
    }
    function pickBlame(path: string) {
        emit('show-blame', path)
        menu.value = null
    }

    const menuStyle = computed(() =>
        menu.value
            ? {
                  left: `${Math.min(menu.value.x, window.innerWidth - 200)}px`,
                  top: `${Math.min(menu.value.y, window.innerHeight - 90)}px`,
              }
            : {}
    )

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
    function discard(file: FileEntry) {
        if (!window.confirm(`Discard changes to "${file.path}"?`)) return
        void run(() => window.api.discardFile(file.path), 'Changes discarded')
    }
    async function discardAll() {
        const ok = await confirmDialog({
            title: 'Discard all changes',
            message: 'All working directory changes and untracked files will be lost.',
            confirmLabel: 'Discard',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.discardAll(), 'All changes discarded')
    }

    function badgeClass(badge: string) {
        const status = badge === '?' || badge === 'R' || badge === 'C' ? 'M' : badge
        return `b-${status.toLowerCase()}`
    }

    // commit title convention: <=50 ideal, 72 hard cap
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
                <i-lucide-file-diff
                    width="16"
                    height="16" /><strong>{{ mode === 'commit' ? 'Commit Changes' : 'Changes' }}</strong>
                <span class="panel-file-num">{{ files.length }}</span>
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
                    class="view-toggle refresh-btn"
                    title="Refresh changes"
                    :disabled="pending"
                    @click="refreshPanel()">
                    <i-lucide-refresh-cw
                        :class="{ spinning: pending }"
                        width="14"
                        height="14" />
                </button>
                <button
                    class="view-toggle"
                    :title="ui.fileViewMode === 'tree' ? 'Show as flat list' : 'Show as tree'"
                    @click="toggleViewMode()">
                    <i-lucide-list
                        v-if="ui.fileViewMode === 'tree'"
                        width="14"
                        height="14" />
                    <i-lucide-folder-tree
                        v-else
                        width="14"
                        height="14" />
                </button>
            </div>
        </div>

        <div class="file-groups">
            <template v-if="mode === 'workdir'">
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
                    @click="toggleDir(row.fullPath)">
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
                    @click="emit('select', { path: row.fullPath, staged: true })">
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
                        @click="discardAll()">
                        Discard all
                    </button>
                    <button
                        v-if="unstaged.length > 0"
                        class="link-btn good"
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
                    @click="toggleDir(row.fullPath)">
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
                    @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, path: row.fullPath }">
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
                Working tree clean
            </div>

            <template v-if="untracked.length > 0">
            <div class="group-header">
                <h4>
                    Untracked <span>{{ untracked.length }}</span>
                </h4>
                <div class="group-header-actions">
                    <button
                        class="link-btn danger"
                        @click="discardAll()">
                        Discard all
                    </button>
                    <button
                        class="link-btn good"
                        @click="stageAll()">
                        Stage all
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
                    @click="toggleDir(row.fullPath)">
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
                    @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, path: row.fullPath }">
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

            <!-- files changed by the selected commit -->
            <template v-else>
                <template
                    v-for="row in commitRows"
                    :key="row.key">
                    <div
                        v-if="row.kind === 'dir'"
                        class="dir-row"
                        :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                        @click="toggleDir(row.fullPath)">
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

            <div
                v-if="menu"
                class="context-menu"
                :style="menuStyle"
                @mouseleave="menu = null">
                <button
                    class="context-menu-item"
                    @click="pickHistory(menu.path)">
                    <i-lucide-history
                        width="12"
                        height="12"
                        style="margin-right: 6px" />
                    View history
                </button>
                <button
                    class="context-menu-item"
                    @click="pickBlame(menu.path)">
                    <i-lucide-scan-search
                        width="12"
                        height="12"
                        style="margin-right: 6px" />
                    Blame
                </button>
            </div>
        </div>

        <div class="commit-box">
            <div
                class="cb-resize-handle"
                title="Drag to resize"
                @mousedown="startResizeBox" />
            <!-- AI commit-message generator (working-directory mode only) -->
            <div
                v-if="mode === 'workdir'"
                class="cb-toolbar">
                <span class="commit-box-label">
                    <i-mage-message-dots
                        width="12"
                        height="12" />
                    Message
                </span>
            </div>
            <!-- read-only when viewing an already-committed commit -->
            <div
                v-if="mode === 'commit' && (commitAuthor || commitDate)"
                class="readonly-meta">
                {{ [commitAuthor, commitDate ? formatCommitDate(commitDate) : ''].filter(Boolean).join(' · ') }}
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
                v-if="mode === 'workdir' && (showAiGroup || message)"
                class="summary-counter">
                <span
                    v-if="showAiGroup"
                    class="counter-model"
                    :title="`Commit-message model: ${commitModelName}`">
                    <i-streamline-flex-color-artificial-intelligence-brain-chip-flat
                        width="14"
                        height="14" />
                    {{ commitModelName }}
                </span>
                <span
                    class="muted"
                    v-if="message && message.split('\n').length > 1">
                    body · {{ message.split('\n').length - 1 }} lines
                </span>
                <span
                    v-if="message"
                    :class="['subject-count', subjectCountClass]">
                    title {{ firstLine.length }} / 72
                </span>
            </div>
            <div class="commit-actions">
                <div
                    v-if="mode === 'workdir' && showAiGroup"
                    class="cb-ai-group">
                    <label
                        class="cb-auto-commit cb-group-item"
                        title="When checked, AI generate stages everything and commits automatically">
                        Auto commit
                        <input
                            v-model="ui.autoCommit"
                            type="checkbox"
                            :disabled="!canGenerate" />
                    </label>
                    <span class="cb-ai-sep" />
                    <button
                        class="btn small cb-ai-btn cb-group-item"
                        :disabled="!canGenerate"
                        title="Generate a commit message from the current changes"
                        @click="generateMessage()">
                        <i-lucide-loader-circle
                            v-if="generating"
                            class="spinning"
                            width="14"
                            height="14" />
                        <i-fluent-emoji-flat-robot
                            v-else
                            width="16"
                            height="16" />
                    </button>
                </div>
                <button
                    class="btn primary commit-btn"
                    :disabled="mode === 'commit' || pending || !message.trim() || staged.length === 0"
                    @click="doCommit()">
                    <i-lucide-loader-circle
                        v-if="committing"
                        class="spinning"
                        width="15"
                        height="15" />
                    <i-lucide-check
                        v-else
                        width="15"
                        height="15" />
                    {{ committing ? 'Committing…' : 'Commit' }}
                </button>
            </div>
        </div>
    </div>
</template>
