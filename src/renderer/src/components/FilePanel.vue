<script setup lang="ts">
    import { formatCommitDate } from '../utils/format'

    import type { CommitFile, FileEntry } from '@shared/types'

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
    const notify = inject<(m: string) => void>('notify', () => {})

    const isWorkdir = computed(() => props.mode === 'workdir')
    const staged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(file => file.staged !== ' ' && file.staged !== '')
            : []
    )
    const unstaged = computed(() =>
        isWorkdir.value
            ? (props.files as FileEntry[]).filter(file => file.staged === ' ' || file.staged === '')
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
    const shortHash = computed(() => props.commitHash.slice(0, 7))
    const message = ref('')
    const amend = ref(false)
    const menu = ref<{ x: number; y: number; path: string } | null>(null)

    async function run(fn: () => Promise<unknown>, ok: string) {
        try {
            await fn()
            await props.refresh()
            notify(ok)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function doCommit() {
        if (!message.value.trim()) return notify('Enter a commit message first')
        if (amend.value && !window.confirm('Amend the last commit with the currently staged changes?')) return
        await run(
            () => window.api.commitWithAmend(message.value.trim(), amend.value),
            amend.value ? 'Commit amended' : 'Committed successfully'
        )
        message.value = ''
        amend.value = false
    }

    async function toggleAmend() {
        amend.value = !amend.value
        if (amend.value && !message.value.trim()) {
            try {
                message.value = (await window.api.lastCommitMessage()).split('\n')[0]
            } catch {
                /* ignore */
            }
        }
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
        void run(() => window.api.unstage([file.path]), 'File unstaged')
    }
    function stage(file: FileEntry) {
        void run(() => window.api.stage([file.path]), 'File staged')
    }
    function unstageAll() {
        void run(() => window.api.unstageAll(), 'Unstaged all files')
    }
    function stageAll() {
        void run(() => window.api.stageAll(), 'Staged all files')
    }
    function discard(file: FileEntry) {
        if (!window.confirm(`Discard changes to "${file.path}"?`)) return
        void run(() => window.api.discardFile(file.path), 'Changes discarded')
    }

    function badgeClass(badge: string) {
        const status = badge === '?' || badge === 'R' || badge === 'C' ? 'M' : badge
        return `b-${status.toLowerCase()}`
    }

    function copyFullHash() {
        if (!props.commitHash) return
        void navigator.clipboard
            .writeText(props.commitHash)
            .then(() => notify('Full hash copied'))
            .catch(() => notify('Copy failed'))
    }

    // commit title convention: <=50 ideal, 72 hard cap
    const firstLine = computed(() => message.value.split('\n')[0] ?? '')
    const subjectCountClass = computed(() =>
        firstLine.value.length > 72 ? 'over' : firstLine.value.length > 50 ? 'warn' : ''
    )
</script>

<template>
    <div class="file-panel">
        <div class="panel-heading">
            <div class="panel-heading-title">
                <FileDiff
                    width="16"
                    height="16" /><strong>Changes</strong>
                <span class="panel-file-num">{{ files.length }}</span>
                <button
                    v-if="mode === 'commit'"
                    class="panel-commit-chip"
                    :title="`Copy full hash\n${commitHash}`"
                    @click="copyFullHash()">
                    {{ shortHash }}
                </button>
            </div>
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
            <span
                v-else
                class="panel-count">{{ files.length }}</span>
        </div>

        <div class="file-groups">
            <template v-if="mode === 'workdir'">
            <div class="group-header">
                <h4>
                    Staged files <span>{{ staged.length }}</span>
                </h4>
                <button
                    v-if="staged.length > 0"
                    class="link-btn"
                    @click="unstageAll()">
                    Unstage all
                </button>
            </div>
            <div
                v-for="file in staged"
                :key="`staged:${file.path}`"
                class="file-row"
                :class="{ selected: selected?.path === file.path && selected.staged }"
                @click="emit('select', { path: file.path, staged: true })">
                <span
                    class="badge"
                    :class="badgeClass(file.staged)"
                    >{{ file.staged }}</span
                >
                <span
                    class="file-path"
                    :title="`${file.path} — ${STATUS_LABEL[file.staged] ?? ''}`"
                    >{{ file.path }}</span
                >
                <button
                    class="icon-btn"
                    title="Unstage"
                    @click.stop="unstage(file)">
                    <i-lucide-minus
                        width="14"
                        height="14" />
                </button>
            </div>
            <div
                v-if="staged.length === 0"
                class="group-empty">
                No staged files
            </div>

            <div class="group-header">
                <h4>
                    Unstaged changes <span>{{ unstaged.length }}</span>
                </h4>
                <button
                    v-if="unstaged.length > 0"
                    class="link-btn"
                    @click="stageAll()">
                    Stage all
                </button>
            </div>
            <div
                v-for="file in unstaged"
                :key="`unstaged:${file.path}`"
                class="file-row"
                :class="{ selected: selected?.path === file.path && !selected.staged }"
                @click="emit('select', { path: file.path, staged: false })"
                @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, path: file.path }">
                <span
                    class="badge"
                    :class="badgeClass(file.unstaged)"
                    >{{ file.unstaged }}</span
                >
                <span
                    class="file-path"
                    :title="`${file.path} — ${STATUS_LABEL[file.unstaged] ?? ''}`"
                    >{{ file.path }}</span
                >
                <button
                    class="icon-btn"
                    title="Stage"
                    @click.stop="stage(file)">
                    <i-lucide-plus
                        width="14"
                        height="14" />
                </button>
                <button
                    class="icon-btn danger"
                    title="Discard changes"
                    @click.stop="discard(file)">
                    <i-lucide-rotate-ccw
                        width="13"
                        height="13" />
                </button>
            </div>
            <div
                v-if="unstaged.length === 0"
                class="group-empty">
                Working tree clean
            </div>
            </template>

            <!-- files changed by the selected commit -->
            <template v-else>
                <div
                    v-for="file in commitFileList"
                    :key="`commit:${file.path}`"
                    class="commit-file-block">
                    <div
                        class="file-row"
                        :class="{ selected: selected?.path === file.path }"
                        @click="emit('select', { path: file.path, staged: false })">
                        <span
                            class="badge"
                            :class="badgeClass(file.status)"
                            >{{ file.status }}</span
                        >
                        <span
                            class="file-path"
                            :title="file.path"
                            >{{ file.path }}</span
                        >
                        <span class="commit-file-stats">
                            <span
                                v-if="file.additions"
                                class="stat-add">+{{ file.additions.toLocaleString() }}</span
                            >
                            <span
                                v-if="file.deletions"
                                class="stat-del">−{{ file.deletions.toLocaleString() }}</span
                            >
                        </span>
                    </div>
                </div>
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
            <label
                v-if="mode === 'workdir'"
                class="amend-toggle">
                <input
                    v-model="amend"
                    type="checkbox"
                    @change="toggleAmend" />
                Amend last commit
            </label>
            <!-- read-only when viewing an already-committed commit -->
            <div
                v-if="mode === 'commit' && (commitAuthor || commitDate)"
                class="readonly-meta">
                {{ [commitAuthor, commitDate ? formatCommitDate(commitDate) : ''].filter(Boolean).join(' · ') }}
            </div>
            <textarea
                v-if="mode === 'commit'"
                :value="commitMessage"
                placeholder="No commit message"
                rows="8"
                readonly />
            <textarea
                v-else
                v-model="message"
                placeholder="Summary of changes"
                rows="8"
                @keydown.enter.meta.prevent="doCommit()"
                @keydown.enter.ctrl.prevent="doCommit()" />
            <div
                v-if="mode === 'workdir' && message"
                class="summary-counter">
                <span
                    class="muted"
                    v-if="message.split('\n').length > 1">
                    body · {{ message.split('\n').length - 1 }} lines
                </span>
                <span :class="['subject-count', subjectCountClass]">
                    title {{ firstLine.length }} / 72
                </span>
            </div>
            <button
                class="btn primary commit-btn"
                :disabled="mode === 'commit' || !message.trim() || staged.length === 0"
                @click="doCommit()">
                <i-lucide-check
                    width="15"
                    height="15" />
                {{ amend ? 'Amend commit' : 'Commit changes' }} <kbd>⌘↵</kbd>
            </button>
            <div
                v-if="mode === 'workdir' && staged.length === 0 && files.length > 0 && !amend"
                class="commit-hint">
                Stage at least one file to commit
            </div>
        </div>
    </div>
</template>
