<script setup lang="ts">
import { ChevronDown, ChevronRight, Copy, GitCommitHorizontal, RotateCcw, X } from 'lucide-vue-next'
import type { CommitDetails as CommitDetailsData, CommitNode, DiffLine } from '@shared/types'

const props = defineProps<{ commit: CommitNode; notify: (message: string) => void }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const refresh = inject<() => Promise<unknown>>('refresh', async () => {})
const ui = useUiStore()

const details = ref<CommitDetailsData | null>(null)
const openFile = ref<string | null>(null)
const fileDiff = ref<DiffLine[]>([])

watch(
    () => props.commit.hash,
    async () => {
        details.value = null
        openFile.value = null
        try {
            details.value = await window.api.commitDetails(props.commit.hash)
        } catch (error) {
            ui.notify(String(error).replace(/^Error:\s*/, ''))
        }
    },
    { immediate: true },
)

watch(openFile, async (file) => {
    if (!file) return
    try {
        fileDiff.value = await window.api.commitFileDiff(props.commit.hash, file)
    } catch {
        fileDiff.value = []
    }
})

const message = computed(() => details.value?.message || props.commit.subject)
const summary = computed(() => message.value.split('\n')[0])
const body = computed(() => message.value.split('\n').slice(2).join('\n').trim())

const stats = computed(() => {
    let additions = 0
    let deletions = 0
    for (const line of details.value?.diff ?? []) {
        if (line.type === 'add') additions++
        else if (line.type === 'del') deletions++
    }
    return { additions, deletions }
})

function toggleFile(path: string) {
    openFile.value = openFile.value === path ? null : path
}

function revertCommit() {
    if (!window.confirm(`Revert commit ${props.commit.shortHash}?`)) return
    void run('Commit reverted', () => window.api.revertCommit(props.commit.hash))
}

function checkout() {
    void run('Checked out commit (detached HEAD)', () => window.api.checkoutCommit(props.commit.hash))
}

function cherryPick() {
    void run('Cherry-picked', () => window.api.cherryPick(props.commit.hash))
}

function copyHash() {
    void navigator.clipboard
        .writeText(props.commit.hash)
        .then(() => ui.notify('Full hash copied'))
        .catch(() => ui.notify('Copy failed'))
}

async function run(label: string, fn: () => Promise<unknown>) {
    try {
        await fn()
        await refresh()
        props.notify(label)
    } catch (error) {
        ui.notify(String(error).replace(/^Error:\s*/, ''))
    }
}

function startResize(event: MouseEvent) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = ui.commitDetailsHeight
    const maxHeight = Math.round(window.innerHeight * 0.7)
    const onMove = (moveEvent: MouseEvent) => {
        // ลากขึ้น = panel สูงขึ้น
        const delta = startY - moveEvent.clientY
        ui.commitDetailsHeight = Math.min(maxHeight, Math.max(120, startHeight + delta))
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

const STATUS_CLASS: Record<string, string> = { A: 'b-a', M: 'b-m', D: 'b-d', U: 'b-u' }

function formatDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const sameDay = new Date().toDateString() === date.toDateString()
    if (sameDay) return `today ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
    <section class="commit-details" :style="{ height: `${ui.commitDetailsHeight}px` }">
        <!-- drag handle -->
        <div class="cd-resize-handle" title="Drag to resize" @mousedown="startResize" />

        <div class="commit-details-heading">
            <div class="commit-details-title">
                <GitCommitHorizontal :size="16" />
                <strong>{{ summary }}</strong>
            </div>
            <div class="cd-heading-actions">
                <button class="detail-action" title="Checkout this commit" @click="checkout()">
                    Checkout
                </button>
                <button class="detail-action" title="Cherry-pick onto current branch" @click="cherryPick()">
                    Cherry-pick
                </button>
                <button class="detail-action danger" title="Revert this commit" @click="revertCommit()">
                    <RotateCcw :size="12" /> Revert
                </button>
            </div>
            <button class="cd-hash" :title="`Copy full hash\n${props.commit.hash}`" @click="copyHash()">
                {{ commit.shortHash }} <Copy :size="12" />
            </button>
            <button class="cd-close" title="Close commit details" @click="emit('close')">
                <X :size="14" />
            </button>
        </div>

        <div class="commit-details-content">
            <div class="commit-actions-row">
                <button
                    v-if="details && details.files.length"
                    class="detail-action"
                    @click="openFile = openFile === null ? (details.files[0]?.path ?? null) : null"
                >
                    <component
                        :is="openFile ? ChevronDown : ChevronRight"
                        :size="12"
                    />
                    {{ details.files.length }} changed files
                </button>
                <span v-else-if="!details" class="muted">Loading…</span>
                <span v-else class="muted">No changed files</span>
            </div>

            <p v-if="body" class="commit-details-body">{{ body }}</p>

            <div class="commit-meta">
                <span class="cd-author">{{ details?.author || commit.author }}</span>
                <span class="cd-date">{{ formatDate(details?.date || commit.date) }}</span>
                <span class="cd-stats">
                    <span v-if="stats.additions" class="stat-add">+{{ stats.additions }}</span>
                    <span v-if="stats.deletions" class="stat-del">−{{ stats.deletions }}</span>
                </span>

                <span class="spacer" />
                <span v-for="ref in commit.refs.slice(0, 3)" :key="ref" class="ref-chip">
                    {{ ref.replace('HEAD -> ', '') }}
                </span>
            </div>

            <div v-if="openFile && details" class="commit-files">
                <div
                    v-for="file in details.files"
                    :key="file.path"
                    class="commit-file-block"
                >
                    <div
                        class="commit-file-row"
                        :class="{ selected: openFile === file.path }"
                        @click="toggleFile(file.path)"
                    >
                        <component
                            :is="openFile === file.path ? ChevronDown : ChevronRight"
                            :size="12"
                            class="muted-icon"
                        />
                        <span class="badge" :class="STATUS_CLASS[file.status.toUpperCase()] ?? 'b-m'">{{ file.status }}</span>
                        <span class="commit-file-path" :title="file.path">{{ file.path }}</span>
                    </div>
                    <div v-if="openFile === file.path" class="commit-file-diff">
                        <div v-for="(line, index) in fileDiff" :key="index" class="diff-line" :class="line.type">
                            <pre v-html="line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')" />
                        </div>
                        <div v-if="fileDiff.length === 0" class="diff-empty">No textual diff available</div>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>
