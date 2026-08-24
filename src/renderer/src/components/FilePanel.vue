<script setup lang="ts">
    import type { CommitFile, DiffLine, FileEntry } from '@shared/types'

    interface Props {
        files: FileEntry[] | CommitFile[]
        selected: { path: string; staged: boolean } | null
        refresh: () => Promise<unknown>
        mode?: 'workdir' | 'commit'
        commitHash?: string
    }
    const props = withDefaults(defineProps<Props>(), { mode: 'workdir', commitHash: '' })
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
    const shortHash = computed(() => props.commitHash.slice(0, 7))
    const message = ref('')
    const amend = ref(false)
    const menu = ref<{ x: number; y: number; path: string } | null>(null)

    // inline diff of a file changed by the selected commit
    const openCommitFile = ref<string | null>(null)
    const commitDiffLines = ref<DiffLine[]>([])

    watch(openCommitFile, async path => {
        commitDiffLines.value = []
        if (!path || !props.commitHash) return
        try {
            commitDiffLines.value = await window.api.commitFileDiff(props.commitHash, path)
        } catch {
            /* ignore */
        }
    })

    function toggleCommitFile(path: string) {
        openCommitFile.value = openCommitFile.value === path ? null : path
    }

    function escapeHtml(text: string) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    }

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
</script>

<template>
    <div class="file-panel">
        <div class="panel-heading">
            <div class="panel-heading-title">
                <FileDiff
                    width="16"
                    height="16" /><strong>Changes</strong>
                <span
                    v-if="mode === 'commit'"
                    class="panel-commit-chip">{{ shortHash }}</span>
            </div>
            <span class="panel-count">{{ files.length }}</span>
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
                        :class="{ selected: openCommitFile === file.path }"
                        @click="toggleCommitFile(file.path)">
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
                    <div
                        v-if="openCommitFile === file.path"
                        class="commit-inline-diff">
                        <div
                            v-for="(line, index) in commitDiffLines"
                            :key="index"
                            class="diff-line"
                            :class="line.type">
                            <!-- eslint-disable-next-line vue/no-v-html -->
                            <pre v-html="escapeHtml(line.text)" />
                        </div>
                        <div
                            v-if="commitDiffLines.length === 0"
                            class="group-empty">
                            No textual changes
                        </div>
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

        <div
            v-if="mode === 'workdir'"
            class="commit-box">
            <label class="amend-toggle">
                <input
                    v-model="amend"
                    type="checkbox"
                    @change="toggleAmend" />
                Amend last commit
            </label>
            <textarea
                v-model="message"
                placeholder="Summary of changes"
                rows="2"
                @keydown.enter.meta.prevent="doCommit()"
                @keydown.enter.ctrl.prevent="doCommit()" />
            <button
                class="btn primary commit-btn"
                :disabled="!message.trim() || staged.length === 0"
                @click="doCommit()">
                <i-lucide-check
                    width="15"
                    height="15" />
                {{ amend ? 'Amend commit' : 'Commit changes' }} <kbd>⌘↵</kbd>
            </button>
            <div
                v-if="staged.length === 0 && files.length > 0 && !amend"
                class="commit-hint">
                Stage at least one file to commit
            </div>
        </div>
    </div>
</template>
