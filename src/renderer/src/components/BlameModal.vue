<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, inject, onMounted, ref, useTemplateRef } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'

    import { useUiStore } from '../stores/ui'
    import { formatDateTime } from '../utils/format'
    import { useModalA11y } from '../utils/modalA11y'
    import CloseXIcon from './CloseXIcon.vue'

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
    const dialog = useTemplateRef<HTMLElement>('dialog')

    useModalA11y({
        active: () => true,
        container: dialog,
        onClose: () => emit('close'),
    })

    const isFullscreen = ref(false)

    /** Ctrl+wheel changes the code font size (plain wheel scrolls as usual). */
    function onCodeWheel(event: WheelEvent) {
        if (!event.ctrlKey) return
        event.preventDefault()
        ui.zoomCodeFontSize(event.deltaY < 0 ? 1 : -1)
    }

    const lines = ref<BlameLine[]>([])
    const loading = ref(true)

    onMounted(async () => {
        try {
            lines.value = await window.api.blame(props.file)
        } catch (error) {
            notify(errorMessage(error))
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
        ref="dialog"
        class="blame-view"
        :class="{ fullscreen: isFullscreen }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blame-title"
        tabindex="-1">
        <div class="diff-header">
            <strong id="blame-title">Blame</strong>
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
                        aria-label="Close blame"
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
