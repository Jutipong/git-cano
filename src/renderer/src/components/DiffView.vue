<script setup lang="ts">
    import { nextTick } from 'vue'

    import { intraLineRange, isWhitespaceOnlyChange, detectMovedLines, renderDiffContent } from '../utils/highlight'

    import type { DiffLine } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    interface Props {
        file: { path: string; staged: boolean } | null
        refresh?: () => Promise<unknown>
        commitHash?: string
    }
    const props = defineProps<Props>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()

    // legacy builds persisted a boolean split toggle under this raw key — clean it up once
    localStorage.removeItem('ogit-diff-mode')

    type DiffViewMode = 'split' | 'inline'

    /** context-line count that makes `git diff` show the whole file */
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
                // diff of a file inside a specific commit
                lines.value = await window.api.commitFileDiff(props.commitHash, f.path, context)
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
        /** hunk header rendered as a full-width separator row */
        hunkHeader?: DiffLine
        /** ordinal of the change this row belongs to (navigation anchor) */
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
            // File headers and no-newline markers are useful in an inline patch,
            // but must not create an empty row in either split pane.
            if (line.type === 'meta') {
                i++
                continue
            }
            if (line.type === 'hunk') {
                // visual separator only — changes are anchored on their first row
                rows.push({ hunkHeader: line })
                inChange = false
                i++
                continue
            }
            if (line.type !== 'del') {
                if (line.type === 'add') {
                    // add-only row: starts a new change group unless it continues one
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
            // GitKraken-style block alignment: the shorter side is padded with
            // blank rows at the TOP so both blocks bottom-align — e.g. 1 del
            // against 26 adds keeps the del next to the LAST added line, with
            // hatched filler rows above it.
            const leftPad = Math.max(0, adds.length - dels.length)
            const rightPad = Math.max(0, dels.length - adds.length)
            const at = (arr: DiffLine[], index: number): DiffLine | undefined =>
                index >= 0 && index < arr.length ? arr[index] : undefined
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

    /** Word-level mark ranges for paired del/add couples, keyed by line object */
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

    /** del/add pairs that differ only in whitespace — rendered dimmed, not as real changes */
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

    /** lines relocated without content edits — rendered as "moved", not -/+ */
    const movedLines = computed(() => detectMovedLines(lines.value))

    /** extra CSS class for a diff line: moved wins over the ws-churn dim */
    function lineFlagClass(line?: DiffLine): string {
        if (!line || (line.type !== 'add' && line.type !== 'del')) return ''
        if (movedLines.value.has(line)) return 'moved'
        if (wsOnly.value.has(line)) return 'ws-only'
        return ''
    }

    /** Hunk header indexes within `lines` — the ordinals consumed by per-hunk staging */
    const hunkHeaderIndexes = computed(() =>
        lines.value.map((line, index) => (line.type === 'hunk' ? index : -1)).filter(index => index >= 0)
    )

    /** indexes of lines that start a change group (first add/del after a non-change line) */
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

    /** number of change groups in the current view mode */
    const changeCount = computed(() =>
        ui.diffViewMode === 'split'
            ? sideBySide.value.reduce((count, row) => count + (row.change !== undefined ? 1 : 0), 0)
            : changeStartIndexes.value.length
    )

    /** rAF scroll animation handle — cancelled when a newer jump supersedes it */
    let scrollAnimation: number | null = null

    /** animated jump that puts the change anchor at the top of the viewport —
     *  fixed short duration so far targets don't feel slow (unlike scrollIntoView smooth) */
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
            const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
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
            // viewing unstaged diff -> stage the hunk (forward); staged diff -> unstage it (reverse)
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

    function lineHtml(line: DiffLine): string {
        if (line.type === 'add' || line.type === 'del') {
            // moved lines are not an edit — no word-level <mark> on them
            const mark = movedLines.value.has(line) ? null : (marks.value.get(line) ?? null)
            return renderDiffContent(line.text, props.file!.path, mark)
        }
        return line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    }

    /* ---------------- Minimap ---------------- */

    const minimapEl = ref<HTMLElement | null>(null)
    const minimapCanvas = ref<HTMLCanvasElement | null>(null)
    const viewportEl = ref<HTMLElement | null>(null)
    const minimapVisible = ref(false)
    /** height of the drawn bar area inside the strip (bars may not fill it) */
    let minimapMapH = 0
    let resizeObserver: ResizeObserver | null = null
    let scrollSyncTimer: ReturnType<typeof setTimeout> | null = null

    type MinimapKind = 'add' | 'del'

    /** minimap bars for the current mode: inline = single column from `lines`, split = two half columns.
     *  Only add/del rows are drawn — ctx/hunk slots stay empty so bar positions match the content. */
    function minimapRows(): { kind?: MinimapKind; left?: MinimapKind; right?: MinimapKind }[] {
        const change = (type?: string) => (type === 'add' || type === 'del' ? (type as MinimapKind) : undefined)
        if (ui.diffViewMode === 'split') {
            return sideBySide.value.map(row =>
                row.hunkHeader ? {} : { left: change(row.left?.type), right: change(row.right?.type) }
            )
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
        const barH = Math.min(2, stripH / rows.length)
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

    /** show/hide the strip and (re)draw it — safe to call on any relevant change */
    function updateMinimap() {
        const body = diffBody.value
        if (!body || !minimapEl.value) return
        const empty = !lines.value.length || meta.value?.binary || meta.value?.image
        const visible = !empty && body.scrollHeight > body.clientHeight + 1
        if (visible && !minimapVisible.value) {
            // the strip just left display:none — wait for layout before measuring it
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

    /** keep the n/m counter in sync with manual scrolling: which change group is at the top */
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

    /* -------- split-view horizontal scroll sync (GitKraken-style) -------- */

    const leftPaneEl = ref<HTMLElement | null>(null)
    const rightPaneEl = ref<HTMLElement | null>(null)
    /** guard so mirroring one pane's scrollLeft doesn't bounce back */
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

    /** horizontal offset is meaningless once the content changes */
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
            <span class="chip">{{ sourceLabel }}</span>
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <span class="spacer" />
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
            </div>
            <button
                class="icon-btn entire-file"
                :class="{ active: ui.showEntireFile }"
                :title="ui.showEntireFile ? 'Show diff only' : 'Show entire file'"
                @click="ui.showEntireFile = !ui.showEntireFile">
                <i-lucide-fold-vertical
                    v-if="ui.showEntireFile"
                    width="15"
                    height="15" />
                <i-lucide-unfold-vertical
                    v-else
                    width="15"
                    height="15" />
            </button>
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
            <span class="spacer" />
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
                                        v-html="lineHtml(row.left)" />
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
                                        v-html="lineHtml(row.right)" />
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
                        <pre v-html="lineHtml(line)" />
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
