<script setup lang="ts">
    import { nextTick } from 'vue'

    import { intraLineRange, isWhitespaceOnlyChange, detectMovedLines, highlightDiffLines } from '../utils/highlight'
    import CloseXIcon from './CloseXIcon.vue'

    import type { ToastKind } from '../stores/uiTransient'
    import type { DiffLine } from '@shared/types'

    interface Props {
        file: { path: string; staged: boolean } | null
        refresh?: () => Promise<unknown>
        commitHash?: string
    }
    const props = defineProps<Props>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()

    localStorage.removeItem('ogit-diff-mode')

    type DiffViewMode = 'split' | 'inline'

    const FULL_FILE_CONTEXT = 999_999

    const lines = ref<DiffLine[]>([])
    const loading = ref(false)
    const isFullscreen = ref(false)
    const meta = ref<{ binary: boolean; image: boolean } | null>(null)
    const images = ref<{ oldUrl: string | null; newUrl: string | null } | null>(null)
    const rawPatch = ref('')

    const diffBody = ref<HTMLElement | null>(null)
    const currentChange = ref(0)

    async function loadDiff() {
        lines.value = []
        meta.value = null
        images.value = null
        rawPatch.value = ''
        currentChange.value = 0
        const f = props.file
        if (!f) return
        loading.value = true
        try {
            const context = ui.showEntireFile ? FULL_FILE_CONTEXT : undefined
            if (props.commitHash) {
                const [commitDiff, commitMeta] = await Promise.all([
                    window.api.commitFileDiff(props.commitHash, f.path, context),
                    window.api.getCommitFileMeta(props.commitHash, f.path),
                ])
                lines.value = commitDiff
                meta.value = commitMeta
                if (commitMeta.image) {
                    images.value = { oldUrl: null, newUrl: await window.api.getCommitImageVersion(props.commitHash, f.path) }
                }
                return
            }
            const [diff, diffMeta, patch] = await Promise.all([
                window.api.diff(f.path, f.staged, context),
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
    }

    watch(() => [props.file, props.commitHash], loadDiff, { immediate: true })
    watch(() => ui.showEntireFile, loadDiff)
    watch(
        () => ui.diffViewMode,
        () => {
            currentChange.value = 0
        }
    )

    const sourceLabel = computed(() => {
        if (props.commitHash) return `${props.commitHash.slice(0, 7)} · commit`
        return props.file?.staged ? 'staged' : 'working directory'
    })

    interface SideBySideRow {
        left?: DiffLine
        right?: DiffLine
        hunkHeader?: DiffLine
        change?: number
    }

    const sideBySide = computed<SideBySideRow[]>(() => {
        if (ui.diffViewMode !== 'split') return []
        const rows: SideBySideRow[] = []
        let change = 0
        let inChange = false
        let i = 0
        while (i < lines.value.length) {
            const line = lines.value[i]
            if (line.type === 'meta') {
                i++
                continue
            }
            if (line.type === 'hunk') {
                rows.push({ hunkHeader: line })
                inChange = false
                i++
                continue
            }
            if (line.type !== 'del') {
                if (line.type === 'add') {
                    rows.push({ right: line, change: inChange ? undefined : change++ })
                    inChange = true
                    i++
                    continue
                }
                const ctx = line.type === 'ctx' ? line : undefined
                rows.push({ left: ctx, right: ctx })
                inChange = false
                i++
                continue
            }
            const dels: DiffLine[] = []
            while (i < lines.value.length && lines.value[i].type === 'del') dels.push(lines.value[i++])
            const adds: DiffLine[] = []
            while (i < lines.value.length && lines.value[i].type === 'add') adds.push(lines.value[i++])
            const leftPad = Math.max(0, adds.length - dels.length)
            const rightPad = Math.max(0, dels.length - adds.length)
            const at = (arr: DiffLine[], index: number): DiffLine | undefined => (index >= 0 && index < arr.length ? arr[index] : undefined)
            for (let p = 0; p < Math.max(dels.length, adds.length); p++) {
                const row: SideBySideRow = { left: at(dels, p - leftPad), right: at(adds, p - rightPad) }
                if (!inChange) {
                    row.change = change++
                    inChange = true
                }
                rows.push(row)
            }
        }
        return rows
    })

    const marks = computed(() => {
        const map = new Map<DiffLine, [number, number] | null>()
        for (let i = 0; i < lines.value.length - 1; i++) {
            if (lines.value[i].type === 'del' && lines.value[i + 1].type === 'add') {
                const range = intraLineRange(lines.value[i].text.slice(1), lines.value[i + 1].text.slice(1))
                if (range) {
                    map.set(lines.value[i], range.old)
                    map.set(lines.value[i + 1], range.new)
                }
                i++
            }
        }
        return map
    })

    const wsOnly = computed(() => {
        const set = new Set<DiffLine>()
        for (let i = 0; i < lines.value.length - 1; i++) {
            if (lines.value[i].type === 'del' && lines.value[i + 1].type === 'add') {
                if (isWhitespaceOnlyChange(lines.value[i].text, lines.value[i + 1].text)) {
                    set.add(lines.value[i])
                    set.add(lines.value[i + 1])
                }
                i++
            }
        }
        return set
    })

    const movedLines = computed(() => detectMovedLines(lines.value))

    function lineFlagClass(line?: DiffLine): string {
        if (!line || (line.type !== 'add' && line.type !== 'del')) return ''
        if (movedLines.value.has(line)) return 'moved'
        if (wsOnly.value.has(line)) return 'ws-only'
        return ''
    }

    const hunkHeaderIndexes = computed(() =>
        lines.value.map((line, index) => (line.type === 'hunk' ? index : -1)).filter(index => index >= 0)
    )

    const changeStartIndexes = computed(() => {
        const indexes: number[] = []
        for (let i = 0; i < lines.value.length; i++) {
            const type = lines.value[i].type
            if ((type === 'add' || type === 'del') && lines.value[i - 1]?.type !== 'add' && lines.value[i - 1]?.type !== 'del') {
                indexes.push(i)
            }
        }
        return indexes
    })

    const changeIndexMap = computed(() => new Map(changeStartIndexes.value.map((lineIndex, i) => [lineIndex, i])))

    const changeCount = computed(() =>
        ui.diffViewMode === 'split'
            ? sideBySide.value.reduce((count, row) => count + (row.change !== undefined ? 1 : 0), 0)
            : changeStartIndexes.value.length
    )

    let scrollAnimation: number | null = null

    function scrollToChange(index: number) {
        const body = diffBody.value
        if (!body) return
        const el = body.querySelector(`[data-change="${index}"]`)
        if (!el) return
        const target = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
        const from = body.scrollTop
        const distance = target - from
        if (Math.abs(distance) < 4) return
        if (scrollAnimation) cancelAnimationFrame(scrollAnimation)
        if (Math.abs(distance) < 120) {
            body.scrollTo({ top: target })
            return
        }
        const duration = 160
        const start = performance.now()
        const step = (now: number) => {
            const t = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - t, 3)
            body.scrollTo({ top: from + distance * eased })
            scrollAnimation = t < 1 ? requestAnimationFrame(step) : null
        }
        scrollAnimation = requestAnimationFrame(step)
    }

    function goToChange(delta: number) {
        if (!changeCount.value) return
        currentChange.value = (currentChange.value + delta + changeCount.value) % changeCount.value
        nextTick(() => scrollToChange(currentChange.value))
    }

    async function actOnHunk(hunkOrdinal: number) {
        if (!props.file || !props.refresh || rawPatch.value.trim() === '') return
        try {
            await useUiTransientStore().withBusy(
                () => window.api.stageHunks(props.file!.path, props.file!.staged, [hunkOrdinal], props.file!.staged),
                props.file.staged ? 'Unstaging…' : 'Staging…'
            )
            await props.refresh()
            notify(props.file.staged ? 'Hunk unstaged' : 'Hunk staged', 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function renderOne(line: DiffLine, highlight: (content: string) => string): string {
        const content = line.text.slice(1)
        if (!content) return ''
        if (line.type !== 'add' && line.type !== 'del') return highlight(content)
        const mark = movedLines.value.has(line) ? null : (marks.value.get(line) ?? null)
        if (!mark) return highlight(content)
        const start = Math.min(mark[0], content.length)
        const end = Math.min(mark[1], content.length)
        if (end <= start) return highlight(content)
        return `${highlight(content.slice(0, start))}<mark>${highlight(content.slice(start, end))}</mark>${highlight(content.slice(end))}`
    }

    const htmlMap = computed(() => highlightDiffLines(lines.value, props.file?.path ?? '', renderOne))

    const minimapEl = ref<HTMLElement | null>(null)
    const minimapCanvas = ref<HTMLCanvasElement | null>(null)
    const viewportEl = ref<HTMLElement | null>(null)
    const minimapVisible = ref(false)
    let minimapMapH = 0
    let resizeObserver: ResizeObserver | null = null
    let scrollSyncTimer: ReturnType<typeof setTimeout> | null = null

    type MinimapKind = 'add' | 'del'

    function minimapRows(): { kind?: MinimapKind; left?: MinimapKind; right?: MinimapKind }[] {
        const change = (type?: string) => (type === 'add' || type === 'del' ? (type as MinimapKind) : undefined)
        if (ui.diffViewMode === 'split') {
            return sideBySide.value.map(row => (row.hunkHeader ? {} : { left: change(row.left?.type), right: change(row.right?.type) }))
        }
        return lines.value.map(line => ({ kind: change(line.type) }))
    }

    function minimapColors(): Record<MinimapKind, { color: string; alpha: number }> {
        const styles = getComputedStyle(document.documentElement)
        const get = (name: string) => styles.getPropertyValue(name).trim()
        return {
            add: { color: get('--green'), alpha: 0.5 },
            del: { color: get('--red'), alpha: 0.5 },
        }
    }

    function drawMinimapBar(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        colors: Record<MinimapKind, { color: string; alpha: number }>,
        kind?: MinimapKind
    ) {
        if (!kind) return
        ctx.globalAlpha = colors[kind].alpha
        ctx.fillStyle = colors[kind].color
        ctx.fillRect(x, y, w, Math.max(h, 0.75))
    }

    function renderMinimap() {
        const canvas = minimapCanvas.value
        const strip = minimapEl.value
        if (!canvas || !strip) return
        const cssW = strip.clientWidth
        const stripH = strip.clientHeight
        if (!cssW || !stripH) return
        const rows = minimapRows()
        if (!rows.length) return
        const barH = stripH / rows.length
        minimapMapH = barH * rows.length
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(stripH * dpr)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, cssW, stripH)
        const colors = minimapColors()
        const pad = 4
        const split = ui.diffViewMode === 'split'
        const halfW = split ? (cssW - pad * 2 - 2) / 2 : cssW - pad * 2
        rows.forEach((row, i) => {
            const y = i * barH
            if (split) {
                drawMinimapBar(ctx, pad, y, halfW, barH, colors, row.left)
                drawMinimapBar(ctx, pad + halfW + 2, y, halfW, barH, colors, row.right)
            } else {
                drawMinimapBar(ctx, pad, y, cssW - pad * 2, barH, colors, row.kind)
            }
        })
    }

    function updateViewport() {
        const body = diffBody.value
        const vp = viewportEl.value
        if (!body || !vp || !minimapVisible.value) return
        const mapH = minimapMapH || minimapEl.value?.clientHeight || 0
        if (!mapH) return
        const ratio = body.clientHeight / body.scrollHeight
        vp.style.height = `${Math.max(ratio * mapH, 14)}px`
        vp.style.top = `${(body.scrollTop / body.scrollHeight) * mapH}px`
    }

    function updateMinimap() {
        const body = diffBody.value
        if (!body || !minimapEl.value) return
        const empty = !lines.value.length || meta.value?.binary || meta.value?.image
        const visible = !empty && body.scrollHeight > body.clientHeight + 1
        if (visible && !minimapVisible.value) {
            minimapVisible.value = true
            nextTick(() => {
                renderMinimap()
                updateViewport()
            })
            return
        }
        if (!visible) {
            minimapVisible.value = false
            return
        }
        renderMinimap()
        updateViewport()
    }

    function minimapScrollTo(event: MouseEvent) {
        const body = diffBody.value
        const strip = minimapEl.value
        if (!body || !strip) return
        const rect = strip.getBoundingClientRect()
        const mapH = minimapMapH || strip.clientHeight
        const target = ((event.clientY - rect.top) / mapH) * body.scrollHeight - body.clientHeight / 2
        body.scrollTo({ top: Math.max(0, Math.min(target, body.scrollHeight - body.clientHeight)) })
    }

    function onMinimapDown(event: MouseEvent) {
        event.preventDefault()
        minimapScrollTo(event)
        const move = (ev: MouseEvent) => minimapScrollTo(ev)
        const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
    }

    function syncChangeCounter() {
        const body = diffBody.value
        if (!body || !changeCount.value || !body.scrollHeight) return
        let rowCount: number
        let anchors: number[]
        if (ui.diffViewMode === 'split') {
            rowCount = sideBySide.value.length
            anchors = []
            sideBySide.value.forEach((row, index) => {
                if (row.change !== undefined) anchors.push(index)
            })
        } else {
            rowCount = lines.value.length
            anchors = changeStartIndexes.value
        }
        if (!anchors.length) return
        const firstVisible = (body.scrollTop / body.scrollHeight) * rowCount
        let seen = 0
        for (const anchor of anchors) {
            if (anchor > firstVisible) break
            seen++
        }
        currentChange.value = Math.min(Math.max(seen - 1, 0), changeCount.value - 1)
    }

    function onBodyScroll() {
        updateViewport()
        if (scrollSyncTimer) clearTimeout(scrollSyncTimer)
        scrollSyncTimer = setTimeout(syncChangeCounter, 150)
    }

    const leftPaneEl = ref<HTMLElement | null>(null)
    const rightPaneEl = ref<HTMLElement | null>(null)
    let syncingX = false

    function onPaneScrollX(side: 'left' | 'right', event: Event) {
        if (syncingX) return
        const source = event.target as HTMLElement
        const target = side === 'left' ? rightPaneEl.value : leftPaneEl.value
        if (!target || target.scrollLeft === source.scrollLeft) return
        syncingX = true
        target.scrollLeft = source.scrollLeft
        requestAnimationFrame(() => {
            syncingX = false
        })
    }

    function resetPaneScroll() {
        if (leftPaneEl.value) leftPaneEl.value.scrollLeft = 0
        if (rightPaneEl.value) rightPaneEl.value.scrollLeft = 0
    }

    onBeforeUnmount(() => {
        if (scrollAnimation) cancelAnimationFrame(scrollAnimation)
        resizeObserver?.disconnect()
        resizeObserver = null
        if (scrollSyncTimer) clearTimeout(scrollSyncTimer)
    })

    watch([diffBody, minimapCanvas], ([body]) => {
        if (body && !resizeObserver) resizeObserver = new ResizeObserver(() => updateMinimap())
        if (body && resizeObserver) resizeObserver.observe(body)
    })

    watch([lines, sideBySide, () => ui.diffViewMode, () => ui.showEntireFile, isFullscreen, () => ui.theme], () =>
        nextTick(() => {
            resetPaneScroll()
            updateMinimap()
        })
    )
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
            <span class="diff-source">· {{ sourceLabel }}</span>
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <div class="diff-header-center">
                <div class="diff-nav">
                    <button
                        class="icon-btn"
                        :disabled="!changeCount"
                        title="Previous change"
                        @click="goToChange(-1)">
                        <i-lucide-arrow-up
                            width="15"
                            height="15" />
                    </button>
                    <span class="chip diff-nav-counter">{{ changeCount ? currentChange + 1 : 0 }}/{{ changeCount }}</span>
                    <button
                        class="icon-btn"
                        :disabled="!changeCount"
                        title="Next change"
                        @click="goToChange(1)">
                        <i-lucide-arrow-down
                            width="15"
                            height="15" />
                    </button>
                </div>
                <div class="segmented">
                    <button
                        class="segmented-btn"
                        :class="{ active: ui.diffViewMode === 'inline' }"
                        title="Inline (unified) view"
                        @click="ui.diffViewMode = 'inline'">
                        <i-lucide-rows3
                            width="15"
                            height="15" />
                    </button>
                    <button
                        class="segmented-btn"
                        :class="{ active: ui.diffViewMode === 'split' }"
                        title="Side-by-side view"
                        @click="ui.diffViewMode = 'split'">
                        <i-lucide-columns2
                            width="15"
                            height="15" />
                    </button>
                    <span class="segmented-divider" />
                    <button
                        class="segmented-btn entire-file"
                        :class="{ active: ui.showEntireFile }"
                        :title="ui.showEntireFile ? 'Show diff only' : 'Show entire file'"
                        @click="ui.showEntireFile = !ui.showEntireFile">
                        <i-lucide-unfold-vertical
                            width="15"
                            height="15" />
                    </button>
                </div>
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
                        title="Close diff"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </div>
            </div>
        </div>

        <div class="diff-main">
            <div
                ref="diffBody"
                class="diff-body"
                :class="{ split: ui.diffViewMode === 'split' }"
                @scroll.passive="onBodyScroll">
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

                <template v-else-if="ui.diffViewMode === 'split'">
                    <div
                        ref="leftPaneEl"
                        class="split-pane left"
                        @scroll.passive="onPaneScrollX('left', $event)">
                        <div class="split-pane-content">
                            <template
                                v-for="(row, index) in sideBySide"
                                :key="index">
                                <div
                                    v-if="row.hunkHeader"
                                    class="split-hunk-separator"
                                    :title="row.hunkHeader.text">
                                    <pre>{{ row.hunkHeader.text }}</pre>
                                </div>
                                <div
                                    v-else
                                    class="diff-line half"
                                    :class="[row.left?.type ?? 'blank', lineFlagClass(row.left)]"
                                    :data-change="row.change">
                                    <span class="ln">{{ row.left?.oldNo ?? '' }}</span>
                                    <pre
                                        v-if="row.left"
                                        v-html="htmlMap.get(row.left) ?? ''" />
                                    <pre v-else></pre>
                                </div>
                            </template>
                        </div>
                    </div>
                    <div
                        ref="rightPaneEl"
                        class="split-pane right"
                        @scroll.passive="onPaneScrollX('right', $event)">
                        <div class="split-pane-content">
                            <template
                                v-for="(row, index) in sideBySide"
                                :key="index">
                                <div
                                    v-if="row.hunkHeader"
                                    class="split-hunk-separator"
                                    :title="row.hunkHeader.text">
                                    <pre>{{ row.hunkHeader.text }}</pre>
                                </div>
                                <div
                                    v-else
                                    class="diff-line half"
                                    :class="[row.right?.type ?? 'blank', lineFlagClass(row.right)]"
                                    :data-change="row.change">
                                    <span class="ln">{{ row.right?.newNo ?? '' }}</span>
                                    <pre
                                        v-if="row.right"
                                        v-html="htmlMap.get(row.right) ?? ''" />
                                    <pre v-else></pre>
                                </div>
                            </template>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div
                        v-for="(line, index) in lines"
                        :key="index"
                        class="diff-line"
                        :class="[line.type, lineFlagClass(line)]"
                        :data-change="changeIndexMap.get(index)">
                        <span class="ln">{{ line.oldNo ?? '' }}</span>
                        <span class="ln">{{ line.newNo ?? '' }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <pre v-html="htmlMap.get(line) ?? ''" />
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

            <div
                v-show="minimapVisible"
                ref="minimapEl"
                class="diff-minimap"
                title="Minimap — click or drag to navigate"
                @mousedown="onMinimapDown">
                <canvas ref="minimapCanvas" />
                <div
                    ref="viewportEl"
                    class="minimap-viewport" />
            </div>
        </div>
    </div>
</template>
