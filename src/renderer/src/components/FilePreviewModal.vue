<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import DOMPurify from 'dompurify'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import { marked } from 'marked'

    import { useUiStore } from '../stores/ui'
    import CloseXIcon from './CloseXIcon.vue'

    import type { FileContent } from '@shared/types'

    const props = defineProps<{
        file: string
        commitHash?: string
        stashHash?: string
    }>()
    const emit = defineEmits<{ (e: 'close'): void }>()

    const ui = useUiStore()
    const isFullscreen = ref(false)
    const loading = ref(true)
    const result = ref<FileContent | null>(null)

    /** Ctrl+wheel changes the code font size (plain wheel scrolls as usual). */
    function onCodeWheel(event: WheelEvent) {
        if (!event.ctrlKey) return
        event.preventDefault()
        ui.zoomCodeFontSize(event.deltaY < 0 ? 1 : -1)
    }

    /**
     * The preview is a document, not a browser: never let a link navigate the app window away.
     * http(s) links go to the OS browser instead; relative/mailto links stay inert.
     */
    function onContentClick(event: MouseEvent) {
        const anchor = (event.target as HTMLElement | null)?.closest('a')
        if (!anchor) return
        event.preventDefault()
        const href = anchor.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) void window.api.openExternal(href).catch(() => {})
    }

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation()
            emit('close')
        }
    }
    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    const kind = computed<'markdown' | 'json'>(() => (props.file.toLowerCase().endsWith('.json') ? 'json' : 'markdown'))
    const sourceLabel = computed(() => {
        if (props.stashHash) return `stash ${props.stashHash.slice(0, 7)}`
        if (props.commitHash) return `commit ${props.commitHash.slice(0, 7)}`
        return 'working tree'
    })

    /**
     * The modal is reused while it stays open (previewing another file / picking another
     * commit-stash updates the props without remounting), so reload on every prop change.
     */
    let seq = 0
    async function load() {
        const my = ++seq
        loading.value = true
        result.value = null
        try {
            const res = props.stashHash
                ? await window.api.stashFileContent(props.stashHash, props.file)
                : props.commitHash
                  ? await window.api.commitFileContent(props.commitHash, props.file)
                  : await window.api.fileContent(props.file, false)
            if (my !== seq) return
            result.value = res
        } catch {
            if (my !== seq) return
            result.value = { content: null, binary: true, tooLarge: false }
        } finally {
            if (my === seq) loading.value = false
        }
    }
    watch(() => [props.file, props.commitHash, props.stashHash] as const, load, { immediate: true })

    const markdownHtml = computed(() => {
        if (kind.value !== 'markdown' || result.value?.content === null || result.value?.content === undefined) return ''
        const raw = marked.parse(result.value.content, { async: false }) as string
        return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
    })

    const jsonState = computed<{ ok: boolean; pretty: string }>(() => {
        if (kind.value !== 'json') return { ok: true, pretty: '' }
        const text = result.value?.content ?? ''
        try {
            return { ok: true, pretty: JSON.stringify(JSON.parse(text), null, 2) }
        } catch {
            return { ok: false, pretty: text }
        }
    })

    function escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    /** Minimal JSON syntax coloring — keys / strings / numbers / literals. */
    const jsonHtml = computed(() => {
        if (kind.value !== 'json' || !jsonState.value.ok) return ''
        return escapeHtml(jsonState.value.pretty).replace(
            /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
            (m, str: string, colon: string, lit: string, num: string) => {
                if (str) return colon ? `<span class="jk">${str}</span>:` : `<span class="js">${str}</span>`
                if (lit) return `<span class="jl">${lit}</span>`
                if (num) return `<span class="jn">${num}</span>`
                return m
            }
        )
    })
</script>

<template>
    <div
        class="preview-view"
        :class="{ fullscreen: isFullscreen }">
        <div class="diff-header">
            <strong>Preview</strong>
            <code class="rebase-base">{{ file }}</code>
            <span class="diff-source">· {{ sourceLabel }}</span>
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
                        title="Close preview"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </div>
            </div>
        </div>
        <div
            class="preview-body"
            :style="{ fontSize: ui.codeFontSize + 'px' }"
            title="Ctrl + scroll to change font size"
            @wheel="onCodeWheel">
            <div
                v-if="loading"
                class="sidebar-empty">
                Loading…
            </div>
            <div
                v-else-if="result?.tooLarge"
                class="sidebar-empty">
                File is too large to preview (over 1 MB)
            </div>
            <div
                v-else-if="result?.binary || result?.content === null"
                class="sidebar-empty">
                Cannot preview this file
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
                v-else-if="kind === 'markdown'"
                class="md-preview"
                @click="onContentClick"
                v-html="markdownHtml" />
            <template v-else>
                <div
                    v-if="!jsonState.ok"
                    class="preview-hint">
                    Invalid JSON — showing raw text
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <pre
                    v-if="jsonState.ok"
                    class="json-preview"
                    v-html="jsonHtml" />
                <pre
                    v-else
                    class="json-preview">{{ jsonState.pretty }}</pre>
            </template>
        </div>
    </div>
</template>
