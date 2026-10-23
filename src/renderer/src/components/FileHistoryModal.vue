<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { inject, onMounted, ref, useTemplateRef } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'

    import { useUiStore } from '../stores/ui'
    import { handleListKeydown } from '../utils/listKeyboard'
    import { useModalA11y } from '../utils/modalA11y'
    import CloseXIcon from './CloseXIcon.vue'

    interface Props {
        file: string
    }
    const props = defineProps<Props>()
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

    interface HistoryCommit {
        hash: string
        shortHash: string
        author: string
        subject: string
    }

    const history = ref<HistoryCommit[]>([])
    const selectedHash = ref<string | null>(null)
    const diffLines = ref<{ type: string; text: string }[]>([])

    onMounted(async () => {
        try {
            history.value = await window.api.fileHistory(props.file)
            if (history.value[0]) select(history.value[0].hash)
        } catch (error) {
            notify(errorMessage(error))
        }
    })

    async function select(hash: string) {
        selectedHash.value = hash
        try {
            diffLines.value = await window.api.commitFileDiff(hash, props.file)
        } catch {
            diffLines.value = []
        }
    }
</script>

<template>
    <div
        ref="dialog"
        class="history-view"
        :class="{ fullscreen: isFullscreen }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        tabindex="-1">
        <div class="diff-header">
            <strong id="history-title">History of</strong>
            <code class="rebase-base">{{ file }}</code>
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
                        title="Close history"
                        aria-label="Close history"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </div>
            </div>
        </div>
        <div class="history-body">
            <div
                class="history-list"
                tabindex="0"
                role="listbox"
                aria-label="File history"
                @keydown="event => handleListKeydown(event, '.history-row')">
                <div
                    v-for="commit in history"
                    :key="commit.hash"
                    class="history-row"
                    tabindex="-1"
                    role="option"
                    :aria-selected="selectedHash === commit.hash"
                    :class="{ selected: selectedHash === commit.hash }"
                    @click="select(commit.hash)">
                    <code>{{ commit.shortHash }}</code>
                    <span class="subject-text">{{ commit.subject }}</span>
                    <span class="commit-author">{{ commit.author }}</span>
                </div>
                <div
                    v-if="history.length === 0"
                    class="sidebar-empty">
                    No commits touch this file
                </div>
            </div>
            <div
                class="history-diff"
                :style="{ fontSize: ui.codeFontSize + 'px' }"
                title="Ctrl + scroll to change font size"
                @wheel="onCodeWheel">
                <pre
                    v-for="(line, index) in diffLines"
                    :key="index"
                    :class="{ 'hd-add': line.type === 'add', 'hd-del': line.type === 'del', 'hd-hunk': line.type === 'hunk' }"
                    >{{ line.text }}</pre>
                <div
                    v-if="diffLines.length === 0"
                    class="sidebar-empty">
                    Select a commit
                </div>
            </div>
        </div>
    </div>
</template>
