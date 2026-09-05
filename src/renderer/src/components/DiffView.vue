<script setup lang="ts">
    import { nextTick } from 'vue'

    import {
        intraLineRange,
        isWhitespaceOnlyChange,
        detectMovedLines,
        computeLineStates,
        highlightLineAt,
        type LineRenderContext,
    } from '../utils/highlight'
    import CloseXIcon from './CloseXIcon.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { ToastKind } from '../stores/uiTransient'
    import type { DiffLine } from '@shared/types'

    interface Props {
        file: { path: string; staged: boolean } | null
        refresh?: () => Promise<unknown>
        commitHash?: string
        stashHash?: string
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
    let loadSeq = 0

    // Virtual scrolling — only the rows in (and around) the viewport are rendered. Every diff row
    // is exactly `rowHeight` tall (white-space: pre, no wrapping), so offsets are pure arithmetic.
    const ROW_HEIGHT = 20
    const OVERSCAN_ROWS = 10
    const rowHeight = ref(ROW_HEIGHT)
    const scrollTop = ref(0)
    const viewportH = ref(0)

    // Per-line highlight cache, keyed by the stable DiffLine objects of the current load.
    let htmlCache = new Map<DiffLine, string>()

    const searchQuery = ref('')
    const searchInput = ref<HTMLInputElement | null>(null)
    const currentMatch = ref(0)

    async function loadDiff() {
        const seq = ++loadSeq
        lines.value = []
        meta.value = null
        images.value = null
        rawPatch.value = ''
        currentChange.value = 0
        htmlCache = new Map()
        const f = props.file
        if (!f) return
        loading.value = true
        try {
            const context = ui.showEntireFile ? FULL_FILE_CONTEXT : undefined
            if (props.stashHash) {
                const [stashDiff, stashMeta] = await Promise.all([
                    window.api.stashFileDiff(props.stashHash, f.path, context),
                    window.api.stashFileMeta(props.stashHash, f.path),
                ])
                if (seq !== loadSeq) return
                lines.value = stashDiff
                meta.value = stashMeta
                if (stashMeta.image) {
                    images.value = { oldUrl: null, newUrl: await window.api.stashImageVersion(props.stashHash, f.path) }
                }
                return
            }
            if (props.commitHash) {
                const [commitDiff, commitMeta] = await Promise.all([
                    window.api.commitFileDiff(props.commitHash, f.path, context),
                    window.api.getCommitFileMeta(props.commitHash, f.path),
                ])
                if (seq !== loadSeq) return
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
            if (seq !== loadSeq) return
            lines.value = diff
            meta.value = diffMeta
            rawPatch.value = patch
            if (diffMeta.image) {
                const [oldUrl, newUrl] = await Promise.all([
                    window.api.imageVersion(f.path, 'head'),
                    f.staged ? window.api.imageVersion(f.path, 'index') : window.api.imageVersion(f.path, 'workdir'),
                ])
                if (seq !== loadSeq) return
                images.value = { oldUrl, newUrl }
            }
        } catch {
            if (seq !== loadSeq) return
            lines.value = []
            meta.value = null
        } finally {
            if (seq === loadSeq) loading.value = false
        }
    }

    watch(() => [props.file, props.commitHash, props.stashHash], loadDiff, { immediate: true })
    watch(() => ui.showEntireFile, loadDiff)
    watch(
        () => ui.diffViewMode,
        () => {
            currentChange.value = 0
        }
    )

    const sourceLabel = computed(() => {
        if (props.stashHash) return `${props.stashHash.slice(0, 7)} · stash`
        if (props.commitHash) return `${props.commitHash.slice(0, 7)} · commit`
        return props.file?.staged ? 'staged' : 'working directory'
    })

    const displayName = computed(() => props.file?.path.split('/').pop() ?? '')

    /**
     * Snapshot fallback (ALL FILES on an unchanged file, in workdir/commit/stash): the main process rendered the full blob as context lines
     * instead of a diff. Detected by the `snapshot <file>` marker the fallbacks emit — real diffs start with `diff --git`, so this is
     * unambiguous. A viewer, not a diff.
     */
    const fullFileView = computed(() => {
        if (loading.value || meta.value?.binary || meta.value?.image) return false
        const first = lines.value[0]
        return !!first && first.type === 'meta' && first.text.startsWith('snapshot ')
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

    function totalRows(): number {
        return ui.diffViewMode === 'split' ? sideBySide.value.length : lines.value.length
    }

    const virtualStart = computed(() => {
        if (!totalRows()) return 0
        return Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN_ROWS)
    })
    const virtualEnd = computed(() =>
        Math.min(totalRows(), Math.ceil((scrollTop.value + (viewportH.value || 800)) / rowHeight.value) + OVERSCAN_ROWS)
    )
    const padTop = computed(() => virtualStart.value * rowHeight.value)
    const padBottom = computed(() => Math.max(0, (totalRows() - virtualEnd.value) * rowHeight.value))

    const virtualLines = computed(() =>
        lines.value.slice(virtualStart.value, virtualEnd.value).map((line, offset) => ({ line, i: virtualStart.value + offset }))
    )
    const virtualRows = computed(() =>
        sideBySide.value.slice(virtualStart.value, virtualEnd.value).map((row, offset) => ({ row, i: virtualStart.value + offset }))
    )

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

    function animateBodyScrollTo(target: number) {
        const body = diffBody.value
        if (!body) return
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

    /** Change #n → row offset: inline uses line indexes, split uses side-by-side row indexes. */
    const splitChangeRowIndexes = computed(() => {
        const indexes: number[] = []
        sideBySide.value.forEach((row, index) => {
            if (row.change !== undefined) indexes.push(index)
        })
        return indexes
    })

    const lineIndexMap = computed(() => {
        const map = new Map<DiffLine, number>()
        lines.value.forEach((line, index) => map.set(line, index))
        return map
    })

    const splitRowByLine = computed(() => {
        const map = new Map<DiffLine, number>()
        sideBySide.value.forEach((row, index) => {
            if (row.left && !map.has(row.left)) map.set(row.left, index)
            if (row.right && !map.has(row.right)) map.set(row.right, index)
        })
        return map
    })

    function scrollToChange(index: number) {
        const body = diffBody.value
        if (!body) return
        const rowIndex = ui.diffViewMode === 'split' ? splitChangeRowIndexes.value[index] : changeStartIndexes.value[index]
        if (rowIndex === undefined) return
        animateBodyScrollTo(rowIndex * rowHeight.value)
    }

    function goToChange(delta: number) {
        if (!changeCount.value) return
        currentChange.value = (currentChange.value + delta + changeCount.value) % changeCount.value
        nextTick(() => scrollToChange(currentChange.value))
    }

    function scrollToSearch(index: number) {
        const body = diffBody.value
        if (!body) return
        const hit = searchHits.value[index]
        if (!hit) return
        const rowIndex = ui.diffViewMode === 'split' ? splitRowByLine.value.get(hit.line) : lineIndexMap.value.get(hit.line)
        if (rowIndex === undefined) return
        animateBodyScrollTo(rowIndex * rowHeight.value - (body.clientHeight - rowHeight.value) / 2)
    }

    function goToMatch(delta: number) {
        const count = searchHits.value.length
        if (!count) return
        currentMatch.value = (currentMatch.value + delta + count) % count
        nextTick(() => scrollToSearch(currentMatch.value))
    }

    function focusSearch() {
        searchInput.value?.focus()
    }

    function onGlobalKeyDown(event: KeyboardEvent) {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f' && props.file) {
            event.preventDefault()
            focusSearch()
        }
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
        const ranges: { start: number; end: number; kind: 'diff' | 'search' }[] = []
        if (line.type === 'add' || line.type === 'del') {
            const mark = movedLines.value.has(line) ? null : (marks.value.get(line) ?? null)
            if (mark && mark[1] > mark[0]) {
                ranges.push({ start: Math.min(mark[0], content.length), end: Math.min(mark[1], content.length), kind: 'diff' })
            }
        }
        for (const [start, end] of searchRangesByLine.value.get(line) ?? []) {
            if (end > start) ranges.push({ start: Math.min(start, content.length), end: Math.min(end, content.length), kind: 'search' })
        }
        if (!ranges.length) return highlight(content)
        const points = [...new Set(ranges.flatMap(range => [range.start, range.end]))].sort((a, b) => a - b)
        const merged: { start: number; end: number; kind: 'diff' | 'search' }[] = []
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i]!
            const end = points[i + 1]!
            let kind: 'diff' | 'search' | null = null
            for (const range of ranges) {
                if (range.start <= start && end <= range.end) {
                    if (range.kind === 'search') {
                        kind = 'search'
                        break
                    }
                    kind = range.kind
                }
            }
            if (kind) merged.push({ start, end, kind })
        }
        let out = ''
        let cursor = 0
        for (const range of merged) {
            if (range.start > cursor) out += highlight(content.slice(cursor, range.start))
            const inner = highlight(content.slice(range.start, range.end))
            out += range.kind === 'search' ? `<mark class="search-hit">${inner}</mark>` : `<mark>${inner}</mark>`
            cursor = range.end
        }
        if (cursor < content.length) out += highlight(content.slice(cursor))
        return out
    }

    const lineStates = computed(() => computeLineStates(lines.value, props.file?.path ?? ''))

    /** Cached per-line highlight (visible lines only, keyed by the stable DiffLine object). */
    function htmlFor(line: DiffLine | undefined, i: number): string {
        if (!line) return ''
        const cached = htmlCache.get(line)
        if (cached !== undefined) return cached
        const context = lineStates.value[i]
        const html = highlightLineAt(line, context ?? computeLineStates([line], props.file?.path ?? '')[0]!, renderOne)
        htmlCache.set(line, html)
        return html
    }

    interface SearchHit {
        line: DiffLine
        ranges: [number, number][]
    }

    const searchHits = computed<SearchHit[]>(() => {
        const query = searchQuery.value.trim()
        const hits: SearchHit[] = []
        if (!query || meta.value?.binary || meta.value?.image) return hits
        const lower = query.toLowerCase()
        for (const line of lines.value) {
            if (line.type === 'hunk' || line.type === 'meta') continue
            const content = line.text.slice(1)
            const ranges: [number, number][] = []
            let from = 0
            while (from < content.length) {
                const i = content.toLowerCase().indexOf(lower, from)
                if (i === -1) break
                ranges.push([i, i + query.length])
                from = i + query.length
            }
            if (ranges.length) hits.push({ line, ranges })
        }
        return hits
    })

    const searchRangesByLine = computed(() => {
        const map = new Map<DiffLine, [number, number][]>()
        for (const hit of searchHits.value) map.set(hit.line, hit.ranges)
        return map
    })

    const searchIndexMap = computed(() => {
        const map = new Map<DiffLine | undefined, number>()
        searchHits.value.forEach((hit, index) => map.set(hit.line, index))
        return map
    })

    const matchCount = computed(() => searchHits.value.length)

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
            anchors = splitChangeRowIndexes.value
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
        const body = diffBody.value
        if (body) scrollTop.value = body.scrollTop
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
        window.removeEventListener('keydown', onGlobalKeyDown, true)
    })

    onMounted(() => window.addEventListener('keydown', onGlobalKeyDown, true))

    /** Actual rendered row height (20px expected) — re-measured as a safety net. */
    function measureRowHeight() {
        const body = diffBody.value
        if (!body) return
        scrollTop.value = body.scrollTop
        viewportH.value = body.clientHeight
        const row = body.querySelector<HTMLElement>('.diff-line')
        if (row && row.offsetHeight > 0) rowHeight.value = row.offsetHeight
    }

    watch(searchQuery, () => {
        currentMatch.value = 0
        htmlCache = new Map()
        if (searchHits.value.length) nextTick(() => scrollToSearch(0))
    })
    watch(searchHits, () => {
        if (currentMatch.value >= searchHits.value.length) currentMatch.value = 0
    })

    watch([diffBody, minimapCanvas], ([body]) => {
        if (body && !resizeObserver)
            resizeObserver = new ResizeObserver(() => {
                viewportH.value = body.clientHeight
                updateMinimap()
            })
        if (body && resizeObserver) resizeObserver.observe(body)
    })

    watch([lines, sideBySide, () => ui.diffViewMode, () => ui.showEntireFile, isFullscreen, () => ui.theme], () =>
        nextTick(() => {
            measureRowHeight()
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
        :class="{ fullscreen: isFullscreen, 'full-file': fullFileView }">
        <div class="diff-header">
            <strong :title="file.path">{{ displayName }}</strong>
            <span class="diff-source">· {{ sourceLabel }}</span>
            <span
                v-if="fullFileView"
                class="chip"
                title="Unchanged file — showing full content"
                >full file</span
            >
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <div class="diff-header-center">
                <div class="diff-search">
                    <div class="diff-search-field">
                        <i-lucide-search
                            width="15"
                            height="15" />
                        <input
                            ref="searchInput"
                            v-model="searchQuery"
                            class="diff-search-input"
                            type="text"
                            placeholder="Find in diff…"
                            title="First Esc leaves the search box, second Esc closes the diff"
                            @keydown.enter.prevent="goToMatch(1)"
                            @keydown.escape.stop="searchInput?.blur()" />
                        <button
                            v-if="searchQuery"
                            type="button"
                            class="search-clear"
                            aria-label="Clear search"
                            @click="searchQuery = ''">
                            ×
                        </button>
                    </div>
                    <div class="diff-nav">
                        <button
                            class="icon-btn"
                            :disabled="!matchCount"
                            title="Previous match"
                            @click="goToMatch(-1)">
                            <i-lucide-arrow-up
                                width="15"
                                height="15" />
                        </button>
                        <span
                            class="chip diff-nav-counter"
                            :class="{ empty: !matchCount }"
                            >{{ matchCount ? currentMatch + 1 : 0 }}/{{ matchCount }}</span
                        >
                        <button
                            class="icon-btn"
                            :disabled="!matchCount"
                            title="Next match"
                            @click="goToMatch(1)">
                            <i-lucide-arrow-down
                                width="15"
                                height="15" />
                        </button>
                    </div>
                </div>
                <div
                    class="diff-nav"
                    title="Navigate between changes">
                    <button
                        class="icon-btn"
                        :disabled="!changeCount"
                        title="Previous change"
                        @click="goToChange(-1)">
                        <i-lucide-arrow-up
                            width="15"
                            height="15" />
                    </button>
                    <span
                        class="chip diff-nav-counter"
                        :class="{ empty: !changeCount }"
                        >{{ changeCount ? currentChange + 1 : 0 }}/{{ changeCount }}</span
                    >
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
                <div
                    v-if="loading"
                    class="diff-loading">
                    <div class="busy-card">
                        <ThinkSpinner suffix="Loading diff…" />
                    </div>
                </div>

                <template v-else-if="meta?.image">
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
                        <div
                            class="split-pane-content"
                            :style="{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }">
                            <template
                                v-for="v in virtualRows"
                                :key="v.i">
                                <div
                                    v-if="v.row.hunkHeader"
                                    class="split-hunk-separator"
                                    :title="v.row.hunkHeader.text">
                                    <pre>{{ v.row.hunkHeader.text }}</pre>
                                </div>
                                <div
                                    v-else
                                    class="diff-line half"
                                    :class="[
                                        v.row.left?.type ?? 'blank',
                                        lineFlagClass(v.row.left),
                                        { 'search-current': searchIndexMap.get(v.row.left) === currentMatch },
                                    ]"
                                    :data-change="v.row.change"
                                    :data-search="searchIndexMap.get(v.row.left)">
                                    <span class="ln">{{ v.row.left?.oldNo ?? '' }}</span>
                                    <pre
                                        v-if="v.row.left"
                                        v-html="htmlFor(v.row.left, v.i)" />
                                    <pre v-else></pre>
                                </div>
                            </template>
                        </div>
                    </div>
                    <div
                        ref="rightPaneEl"
                        class="split-pane right"
                        @scroll.passive="onPaneScrollX('right', $event)">
                        <div
                            class="split-pane-content"
                            :style="{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }">
                            <template
                                v-for="v in virtualRows"
                                :key="v.i">
                                <div
                                    v-if="v.row.hunkHeader"
                                    class="split-hunk-separator"
                                    :title="v.row.hunkHeader.text">
                                    <pre>{{ v.row.hunkHeader.text }}</pre>
                                </div>
                                <div
                                    v-else
                                    class="diff-line half"
                                    :class="[
                                        v.row.right?.type ?? 'blank',
                                        lineFlagClass(v.row.right),
                                        { 'search-current': searchIndexMap.get(v.row.right) === currentMatch },
                                    ]"
                                    :data-change="v.row.change"
                                    :data-search="searchIndexMap.get(v.row.right)">
                                    <span class="ln">{{ v.row.right?.newNo ?? '' }}</span>
                                    <pre
                                        v-if="v.row.right"
                                        v-html="htmlFor(v.row.right, v.i)" />
                                    <pre v-else></pre>
                                </div>
                            </template>
                        </div>
                    </div>
                </template>

                <template v-else>
                    <div
                        class="diff-spacer"
                        :style="{ height: `${padTop}px` }" />
                    <div
                        v-for="v in virtualLines"
                        :key="v.i"
                        class="diff-line"
                        :class="[v.line.type, lineFlagClass(v.line), { 'search-current': searchIndexMap.get(v.line) === currentMatch }]"
                        :data-change="changeIndexMap.get(v.i)"
                        :data-search="searchIndexMap.get(v.line)">
                        <span class="ln">{{ v.line.oldNo ?? '' }}</span>
                        <span class="ln">{{ v.line.newNo ?? '' }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html -->
                        <pre v-html="htmlFor(v.line, v.i)" />
                        <button
                            v-if="!commitHash && !stashHash && v.line.type === 'hunk' && refresh && !meta?.binary && !fullFileView"
                            class="detail-action hunk-action"
                            :title="file.staged ? 'Unstage this hunk' : 'Stage just this hunk'"
                            @click="actOnHunk(hunkHeaderIndexes.indexOf(v.i))">
                            {{ file.staged ? '− Unstage hunk' : '+ Stage hunk' }}
                        </button>
                    </div>
                    <div
                        class="diff-spacer"
                        :style="{ height: `${padBottom}px` }" />
                    <div
                        v-if="lines.length === 0 && !loading"
                        class="diff-empty">
                        No textual changes
                    </div>
                </template>
            </div>

            <div
                v-show="minimapVisible && !fullFileView"
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
