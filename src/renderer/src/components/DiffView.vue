<script setup lang="ts">
    import { intraLineRange, renderDiffContent } from '../utils/highlight'

    import type { DiffLine } from '@shared/types'

    interface Props {
        file: { path: string; staged: boolean } | null
        refresh?: () => Promise<unknown>
        commitHash?: string
    }
    const props = defineProps<Props>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    const lines = ref<DiffLine[]>([])
    const loading = ref(false)
    const isFullscreen = ref(false)
    const splitMode = ref(localStorage.getItem('ogit-diff-mode') === 'split')
    const meta = ref<{ binary: boolean; image: boolean } | null>(null)
    const images = ref<{ oldUrl: string | null; newUrl: string | null } | null>(null)
    const rawPatch = ref('')

    watch(splitMode, value => localStorage.setItem('ogit-diff-mode', value ? 'split' : 'unified'))

    watch(
        () => [props.file, props.commitHash],
        async ([file]) => {
            lines.value = []
            meta.value = null
            images.value = null
            rawPatch.value = ''
            const f = file as { path: string; staged: boolean } | null
            if (!f) return
            loading.value = true
            try {
                if (props.commitHash) {
                    // diff of a file inside a specific commit
                    lines.value = await window.api.commitFileDiff(props.commitHash, f.path)
                    return
                }
                const [diff, diffMeta, patch] = await Promise.all([
                    window.api.diff(f.path, f.staged),
                    window.api.diffMeta(f.path, f.staged),
                    window.api.rawPatch(f.path, f.staged),
                ])
                lines.value = diff
                meta.value = diffMeta
                rawPatch.value = patch
                if (diffMeta.image) {
                    const [oldUrl, newUrl] = await Promise.all([
                        window.api.imageVersion(f.path, 'head'),
                        f.staged ? window.api.imageVersion(f.path, 'index') : window.api.imageVersion(f.path, 'workdir'),
                    ])
                    images.value = { oldUrl, newUrl }
                }
            } catch {
                lines.value = []
                meta.value = null
            } finally {
                loading.value = false
            }
        },
        { immediate: true }
    )

    const sourceLabel = computed(() => {
        if (props.commitHash) return `${props.commitHash.slice(0, 7)} · commit`
        return props.file?.staged ? 'staged' : 'working directory'
    })

    interface SideBySideRow {
        left?: DiffLine
        right?: DiffLine
    }

    const sideBySide = computed<SideBySideRow[]>(() => {
        if (!splitMode.value) return []
        const rows: SideBySideRow[] = []
        let i = 0
        while (i < lines.value.length) {
            const line = lines.value[i]
            if (line.type !== 'del') {
                rows.push(
                    line.type === 'add'
                        ? { right: line }
                        : (() => {
                              const ctx = line.type === 'ctx' ? line : undefined
                              return { left: ctx, right: ctx }
                          })()
                )
                i++
                continue
            }
            const dels: DiffLine[] = []
            while (i < lines.value.length && lines.value[i].type === 'del') dels.push(lines.value[i++])
            const adds: DiffLine[] = []
            while (i < lines.value.length && lines.value[i].type === 'add') adds.push(lines.value[i++])
            for (let p = 0; p < Math.max(dels.length, adds.length); p++) rows.push({ left: dels[p], right: adds[p] })
        }
        return rows
    })

    /** Word-level mark ranges for paired del/add couples */
    const marks = computed(() => {
        const map = new Map<number, [number, number] | null>()
        for (let i = 0; i < lines.value.length - 1; i++) {
            if (lines.value[i].type === 'del' && lines.value[i + 1].type === 'add') {
                const range = intraLineRange(lines.value[i].text.slice(1), lines.value[i + 1].text.slice(1))
                if (range) {
                    map.set(i, range.old)
                    map.set(i + 1, range.new)
                }
                i++
            }
        }
        return map
    })

    /** Hunk header indexes within `lines`, used by per-hunk actions */
    const hunkHeaderIndexes = computed(() =>
        lines.value.map((line, index) => (line.type === 'hunk' ? index : -1)).filter(index => index >= 0)
    )

    async function actOnHunk(hunkOrdinal: number) {
        if (!props.file || !props.refresh || rawPatch.value.trim() === '') return
        try {
            // viewing unstaged diff -> stage the hunk (forward); staged diff -> unstage it (reverse)
            await window.api.stageHunks(props.file.path, props.file.staged, [hunkOrdinal], props.file.staged)
            await props.refresh()
            notify(props.file.staged ? 'Hunk unstaged' : 'Hunk staged')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function lineHtml(line: DiffLine, index?: number): string {
        if (line.type === 'add' || line.type === 'del') {
            const mark = index !== undefined ? (marks.value.get(index) ?? null) : null
            return renderDiffContent(line.text, props.file!.path, mark)
        }
        return line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    }
</script>

<template>
    <div
        v-if="!file"
        class="diff-view empty"
        :class="{ fullscreen: isFullscreen }">
        <p>Select a file to view its diff</p>
    </div>
    <div
        v-else
        class="diff-view"
        :class="{ fullscreen: isFullscreen }">
        <div class="diff-header">
            <strong>{{ file.path }}</strong>
            <span class="chip">{{ sourceLabel }}</span>
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <span class="spacer" />
            <button
                class="icon-btn"
                :title="splitMode ? 'Unified view' : 'Side-by-side view'"
                @click="splitMode = !splitMode">
                <i-lucide-rows3
                    v-if="splitMode"
                    width="15"
                    height="15" />
                <i-lucide-columns2
                    v-else
                    width="15"
                    height="15" />
            </button>
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
                title="Close diff"
                @click="emit('close')">
                <i-lucide-x
                    width="15"
                    height="15" />
            </button>
        </div>

        <div
            class="diff-body"
            :class="{ split: splitMode }">
            <template v-if="meta?.image">
                <div class="image-diff">
                    <figure>
                        <figcaption>Previous</figcaption>
                        <img
                            v-if="images?.oldUrl"
                            :src="images.oldUrl"
                            alt="previous version" />
                        <div
                            v-else
                            class="image-empty">
                            No image
                        </div>
                    </figure>
                    <figure>
                        <figcaption>Current</figcaption>
                        <img
                            v-if="images?.newUrl"
                            :src="images.newUrl"
                            alt="current version" />
                        <div
                            v-else
                            class="image-empty">
                            No image
                        </div>
                    </figure>
                </div>
            </template>

            <div
                v-else-if="meta?.binary"
                class="diff-empty">
                Binary file differs — content not shown
            </div>

            <template v-else-if="splitMode">
                <div
                    v-for="(row, index) in sideBySide"
                    :key="index"
                    class="split-row">
                    <div
                        class="diff-line half"
                        :class="[row.left?.type ?? 'blank']">
                        <span class="ln">{{ row.left?.oldNo ?? '' }}</span>
                        <pre
                            v-if="row.left"
                            v-html="lineHtml(row.left)" />
                        <pre v-else></pre>
                    </div>
                    <div
                        class="diff-line half"
                        :class="[row.right?.type ?? 'blank']">
                        <span class="ln">{{ row.right?.newNo ?? '' }}</span>
                        <pre
                            v-if="row.right"
                            v-html="lineHtml(row.right)" />
                        <pre v-else></pre>
                    </div>
                </div>
            </template>

            <template v-else>
                <div
                    v-for="(line, index) in lines"
                    :key="index"
                    class="diff-line"
                    :class="line.type">
                    <span class="ln">{{ line.oldNo ?? '' }}</span>
                    <span class="ln">{{ line.newNo ?? '' }}</span>
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <pre v-html="lineHtml(line, index)" />
                    <button
                        v-if="!commitHash && line.type === 'hunk' && refresh && !meta?.binary"
                        class="detail-action hunk-action"
                        :title="file.staged ? 'Unstage this hunk' : 'Stage just this hunk'"
                        @click="actOnHunk(hunkHeaderIndexes.indexOf(index))">
                        {{ file.staged ? '− Unstage hunk' : '+ Stage hunk' }}
                    </button>
                </div>
                <div
                    v-if="lines.length === 0 && !loading"
                    class="diff-empty">
                    No textual changes
                </div>
            </template>
        </div>
    </div>
</template>
