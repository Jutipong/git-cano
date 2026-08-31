<script setup lang="ts">
    import CloseXIcon from './CloseXIcon.vue'

    import { formatDateTime } from '../utils/format'

    interface BlameLine {
        hash: string
        author: string
        date: string
        lineNumber: number
        content: string
    }

    const props = defineProps<{ file: string }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})
    const ui = useUiStore()

    const isFullscreen = ref(false)

    /** Ctrl+wheel changes the code font size (plain wheel scrolls as usual). */
    function onCodeWheel(event: WheelEvent) {
        if (!event.ctrlKey) return
        event.preventDefault()
        ui.zoomCodeFontSize(event.deltaY < 0 ? 1 : -1)
    }

    const lines = ref<BlameLine[]>([])
    const loading = ref(true)

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation()
            emit('close')
        }
    }
    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    onMounted(async () => {
        try {
            lines.value = await window.api.blame(props.file)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        } finally {
            loading.value = false
        }
    })

    const shadeOf = computed(() => {
        const map = new Map<string, number>()
        let blockIndex = -1
        for (const line of lines.value) {
            if (!map.has(line.hash)) map.set(line.hash, ++blockIndex % 2)
        }
        return map
    })


</script>

<template>
    <div
        class="blame-view"
        :class="{ fullscreen: isFullscreen }">
        <div class="diff-header">
            <strong>Blame</strong>
            <code class="rebase-base">{{ file }}</code>
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <div class="diff-header-center">
                <div class="segmented diff-header-actions">
                    <button
                        class="icon-btn"
                        :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
                        @click="isFullscreen = !isFullscreen">
                        <i-lucide-minimize
                            v-if="isFullscreen"
                            width="15"
                            height="15" />
                        <i-lucide-maximize
                            v-else
                            width="15"
                            height="15" />
                    </button>
                    <button
                        class="icon-btn danger diff-close-btn"
                        title="Close blame"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </div>
            </div>
        </div>
        <div
            class="blame-body"
            :style="{ fontSize: ui.codeFontSize + 'px' }"
            title="Ctrl + scroll to change font size"
            @wheel="onCodeWheel">
            <div
                v-for="line in lines"
                :key="line.lineNumber"
                class="blame-line"
                :class="`shade-${shadeOf.get(line.hash) ?? 0}`">
                <code class="blame-hash">{{ line.hash.slice(0, 7) }}</code>
                <span class="blame-author">{{ line.author }}</span>
                <span class="blame-date">{{ formatDateTime(line.date) }}</span>
                <span class="blame-ln">{{ line.lineNumber }}</span>
                <pre>{{ line.content }}</pre>
            </div>
            <div
                v-if="!loading && lines.length === 0"
                class="sidebar-empty">
                Nothing to blame
            </div>
        </div>
    </div>
</template>
