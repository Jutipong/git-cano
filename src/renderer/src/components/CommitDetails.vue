<script setup lang="ts">
import { Copy, GitCommitHorizontal, X } from 'lucide-vue-next'
import type { CommitDetails as CommitDetailsData, CommitNode } from '@shared/types'

const props = defineProps<{ commit: CommitNode; notify: (message: string) => void }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const ui = useUiStore()

const details = ref<CommitDetailsData | null>(null)

watch(
    () => props.commit.hash,
    async () => {
        details.value = null
        try {
            details.value = await window.api.commitDetails(props.commit.hash)
        } catch (error) {
            ui.notify(String(error).replace(/^Error:\s*/, ''))
        }
    },
    { immediate: true },
)

const message = computed(() => details.value?.message || props.commit.subject)
const summary = computed(() => message.value.split('\n')[0])
const body = computed(() => message.value.split('\n').slice(2).join('\n').trim())

function copyHash() {
    void navigator.clipboard
        .writeText(props.commit.hash)
        .then(() => ui.notify('Full hash copied'))
        .catch(() => ui.notify('Copy failed'))
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

function formatDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const today = new Date()
    const daysAgo = Math.floor((today.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
    if (daysAgo === 0) return `Today at ${time}`
    if (daysAgo === 1) return `Yesterday at ${time}`
    if (daysAgo > 1 && daysAgo < 7)
        return `${date.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
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
            <button class="cd-hash" :title="`Copy full hash\n${props.commit.hash}`" @click="copyHash()">
                {{ commit.shortHash }} <Copy :size="12" />
            </button>
            <button class="cd-close" title="Close commit details" @click="emit('close')">
                <X :size="14" />
            </button>
        </div>

        <div class="commit-details-content">
            <div class="commit-actions-row">
                <span
                    v-if="details && details.files.length"
                    class="cd-files-count">{{ details.files.length }} changed files</span>
                <span v-else-if="!details" class="muted">Loading…</span>
                <span v-else class="muted">No changed files</span>

                <span class="spacer" />
                <span class="cd-author">{{ details?.author || commit.author }}</span>
                <span class="cd-date">{{ formatDate(details?.date || commit.date) }}</span>
                <span
                    v-for="ref in commit.refs.slice(0, 3)"
                    :key="ref"
                    class="ref-chip">
                    {{ ref.replace('HEAD -> ', '') }}
                </span>
            </div>

            <p v-if="body" class="commit-details-body">{{ body }}</p>
        </div>
    </section>
</template>
