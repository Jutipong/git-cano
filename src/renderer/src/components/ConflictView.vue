<script setup lang="ts">
    import { nextTick, computed, ref, watch, inject } from 'vue'
    import ILucideArrowDown from '~icons/lucide/arrow-down'
    import ILucideArrowUp from '~icons/lucide/arrow-up'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucidePencil from '~icons/lucide/pencil'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import ILucideSave from '~icons/lucide/save'

    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import { confirmDialog } from '../utils/confirm'
    import { highlightLine, computeLineStates, highlightLineAt, type LineRenderContext } from '../utils/highlight'
    import { buildPrefix, windowFor } from '../utils/virtual'
    import CloseXIcon from './CloseXIcon.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { ConflictVersions, DiffLine } from '@shared/types'

    interface Props {
        file: { path: string } | null
        refresh?: () => Promise<unknown>
    }
    const props = defineProps<Props>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const repoStore = useRepoStore()

    interface ConflictBlock {
        ours: string[]
        theirs: string[]
        /** Name of the incoming side parsed from the `>>>>>>>` marker. */
        label: string
        /** Per-line picks (GitKraken-style: a hunk can be taken whole or line by line). */
        pickOursLines: boolean[]
        pickTheirsLines: boolean[]
        matchIdx: { ours: number; theirs: number }
    }

    const loading = ref(false)
    const isFullscreen = ref(false)
    /** Working-tree content (contains the conflict markers). */
    const worktree = ref('')
    const versions = ref<ConflictVersions | null>(null)
    const blocks = ref<ConflictBlock[]>([])
    /** Conflict the prev/next navigation points at (-1 = none yet). */
    const currentBlock = ref(-1)
    /**
     * Manual output editing (GitKraken-style "type in the output box to fine-tune"). null = output is driven by the picks; a string = the
     * user took over and edits by hand (picks no longer change the output until the edits are discarded). Declared before loadConflict
     * because the immediate watch runs during setup.
     */
    const manualOutput = ref<string | null>(null)

    // ---- virtualization state (declared before loadConflict — the immediate watch runs during setup) ----

    // Conflict rows: 20px base line-height (.diff-line pre / .ln in styles.css); the block-outline
    // borders add 2px on block edges (modern-ui.css .blk-top / .blk-bottom) and the first row
    // of every block reserves 26px on top for the full-width "Use side" banner bar.
    const CONFLICT_ROW_H = 20
    const CONFLICT_BORDER_H = 2
    const BLOCK_BANNER_H = 26
    /** Unresolved-block placeholder card height in the output pane (must match .out-gap height). */
    const OUTPUT_GAP_H = 64
    const OVERSCAN_PX = 400

    /** Per-line highlight caches for the two version panes, keyed by the stable DiffLine objects. */
    const paneHtmlCache: Record<'ours' | 'theirs', Map<DiffLine, string>> = { ours: new Map(), theirs: new Map() }

    const MARK_OURS = /^<{7}(?: (.*))?$/
    const MARK_BASE = /^\|{7}(?: .*)?$/
    const MARK_SEP = /^={7}$/
    const MARK_THEIRS = /^>{7}(?: (.*))?$/

    function parseBlocks(text: string, fallbackTheirs: string): ConflictBlock[] {
        const lines = text.split('\n')
        const blocks: ConflictBlock[] = []
        let i = 0
        while (i < lines.length) {
            if (!MARK_OURS.test(lines[i])) {
                i++
                continue
            }
            const ours: string[] = []
            const theirs: string[] = []
            i++
            while (i < lines.length && !MARK_BASE.test(lines[i]) && !MARK_SEP.test(lines[i]) && !MARK_THEIRS.test(lines[i])) {
                ours.push(lines[i])
                i++
            }
            // diff3 style (||||||| base =======) — the base section is skipped
            if (MARK_BASE.test(lines[i] ?? '')) {
                i++
                while (i < lines.length && !MARK_SEP.test(lines[i])) i++
            }
            if (MARK_SEP.test(lines[i] ?? '')) {
                i++
                while (i < lines.length && !MARK_THEIRS.test(lines[i])) {
                    theirs.push(lines[i])
                    i++
                }
            }
            const labelM = MARK_THEIRS.exec(lines[i] ?? '')
            const label = labelM?.[1]?.trim() || fallbackTheirs
            if (MARK_THEIRS.test(lines[i] ?? '')) i++
            blocks.push({
                ours,
                theirs,
                label,
                pickOursLines: Array.from({ length: ours.length }, () => false),
                pickTheirsLines: Array.from({ length: theirs.length }, () => false),
                matchIdx: { ours: -1, theirs: -1 },
            })
        }
        return blocks
    }

    function matchSequence(hay: string[], needle: string[], from: number): number {
        if (!needle.length) return -1
        for (let i = Math.max(0, from); i <= hay.length - needle.length; i++) {
            let ok = true
            for (let j = 0; j < needle.length; j++) {
                if (hay[i + j] !== needle[j]) {
                    ok = false
                    break
                }
            }
            if (ok) return i
        }
        return -1
    }

    function annotateMatches(blocks: ConflictBlock[]) {
        const oursLines = (versions.value?.ours ?? '').split('\n')
        const theirsLines = (versions.value?.theirs ?? '').split('\n')
        let fromOurs = 0
        let fromTheirs = 0
        for (const block of blocks) {
            block.matchIdx.ours = matchSequence(oursLines, block.ours, fromOurs)
            if (block.matchIdx.ours >= 0) fromOurs = block.matchIdx.ours + block.ours.length
            block.matchIdx.theirs = matchSequence(theirsLines, block.theirs, fromTheirs)
            if (block.matchIdx.theirs >= 0) fromTheirs = block.matchIdx.theirs + block.theirs.length
        }
    }

    async function loadConflict() {
        const f = props.file
        if (!f) return
        loading.value = true
        worktree.value = ''
        versions.value = null
        blocks.value = []
        currentBlock.value = -1
        manualOutput.value = null
        paneHtmlCache.ours.clear()
        paneHtmlCache.theirs.clear()
        try {
            const [content, vers] = await Promise.all([window.api.readConflictFile(f.path), window.api.conflictVersions(f.path)])
            if (props.file !== f) return
            versions.value = vers
            if (content === null) {
                // no working-tree file (e.g. delete/modify conflict) — nothing to merge here,
                // fall back to the regular diff view
                notify('No conflict markers found — opening diff view', 'info')
                repoStore.selectedConflict = null
                repoStore.selectedFile = { path: f.path, staged: false }
                return
            }
            worktree.value = content.replace(/\r\n/g, '\n')
            const parsed = parseBlocks(worktree.value, repoStore.theirsLabel)
            annotateMatches(parsed)
            blocks.value = parsed
            currentBlock.value = parsed.length ? 0 : -1
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            loading.value = false
        }
    }

    watch(() => props.file, loadConflict, { immediate: true })

    /** A block is unresolved until at least one line of either side is picked. */
    const unresolvedCount = computed(
        () => blocks.value.filter(block => !block.pickOursLines.some(Boolean) && !block.pickTheirsLines.some(Boolean)).length
    )
    /** Save allowed only when every block is picked (manual edit always allowed — output is typed directly). */
    const canSave = computed(() => manualOutput.value !== null || unresolvedCount.value === 0)
    const resolvedCount = computed(() => blocks.value.length - unresolvedCount.value)
    const progressPct = computed(() => (blocks.value.length ? Math.round((resolvedCount.value / blocks.value.length) * 100) : 100))
    /** Header counter — always 1-based now that the first block is auto-selected on load. */
    const navLabel = computed(() => {
        if (!blocks.value.length) return '0 / 0'
        return `${currentBlock.value + 1} / ${blocks.value.length}`
    })
    const navTitle = computed(() => {
        if (!blocks.value.length) return 'No conflicts'
        return `Conflict ${currentBlock.value + 1} of ${blocks.value.length} — ${resolvedCount.value} resolved`
    })

    /** Banner-bar label for a whole side (includes the line count so the pick is predictable). */
    function blockUseLabel(side: Side, blockIndex: number): string {
        const block = blocks.value[blockIndex]
        const name = side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel
        const n = block?.[side].length ?? 0
        return `Use ${name} · ${n} line${n === 1 ? '' : 's'}`
    }

    /**
     * The output file assembled from the picked lines (per block: ours first, then theirs); fully unresolved blocks keep their raw markers
     * so they are visible (and make the main-process marker validation fail).
     */
    interface OutLine {
        text: string
        /** Block index this line belongs to, or -1 for common context. */
        block: number
    }
    const resultLines = computed<OutLine[]>(() => {
        const lines = worktree.value.split('\n')
        const out: OutLine[] = []
        let blockIdx = 0
        let i = 0
        while (i < lines.length) {
            if (!MARK_OURS.test(lines[i])) {
                out.push({ text: lines[i], block: -1 })
                i++
                continue
            }
            const idx = blockIdx++
            const block = blocks.value[idx]
            const start = i
            i++
            while (i < lines.length && !MARK_THEIRS.test(lines[i])) i++
            const end = i < lines.length ? i : lines.length - 1 // last marker line (or EOF)
            if (block && (block.pickOursLines.some(Boolean) || block.pickTheirsLines.some(Boolean))) {
                block.ours.forEach((text, li) => {
                    if (block.pickOursLines[li]) out.push({ text, block: idx })
                })
                block.theirs.forEach((text, li) => {
                    if (block.pickTheirsLines[li]) out.push({ text, block: idx })
                })
            } else {
                lines.slice(start, end + 1).forEach(text => out.push({ text, block: idx }))
            }
            if (i < lines.length) i++ // skip >>>>>>> line
        }
        return out
    })

    const resultContent = computed(() => resultLines.value.map(line => line.text).join('\n'))

    // highlightLine is pure per (path, text) — caching keeps checkbox toggles cheap: only
    // genuinely new output lines get highlighted, the rest reuse the cached HTML string.
    // Looked up lazily per rendered row (virtualized) instead of rebuilding an O(n) array per toggle.
    const outputHtmlCache = new Map<string, string>()
    function outputHtmlFor(idx: number): string {
        const row = outputDisplay.value[idx]
        if (!row || row.kind !== 'line') return ''
        const key = `${props.file?.path ?? ''}\u0000${row.text}`
        let html = outputHtmlCache.get(key)
        if (html === undefined) {
            html = highlightLine(row.text, props.file?.path ?? '')
            outputHtmlCache.set(key, html)
        }
        return html
    }

    // ---- manual output editing (GitKraken-style "type in the output box to fine-tune") ----

    function startManualEdit() {
        if (manualOutput.value === null) manualOutput.value = resultContent.value
    }

    async function discardManualEdit() {
        if (manualOutput.value === null) return
        const ok = await confirmDialog({
            title: 'Discard manual edits?',
            message: 'Your hand-edited output will be replaced by the picks-driven result.',
            confirmLabel: 'Discard',
            danger: true,
            confirmIcon: 'reset',
        })
        if (ok) manualOutput.value = null
    }

    /** Block-level checkbox: take (or un-take) every line of this side. */
    function togglePick(side: Side, blockIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        const lines = side === 'ours' ? block.pickOursLines : block.pickTheirsLines
        const take = !lines.some(Boolean)
        lines.fill(take)
    }

    function isPicked(side: Side, blockIndex: number): boolean {
        const block = blocks.value[blockIndex]
        if (!block) return false
        return (side === 'ours' ? block.pickOursLines : block.pickTheirsLines).some(Boolean)
    }

    function toggleLine(side: Side, blockIndex: number, lineIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        const lines = side === 'ours' ? block.pickOursLines : block.pickTheirsLines
        lines[lineIndex] = !lines[lineIndex]
    }

    function isLinePicked(side: Side, blockIndex: number, lineIndex: number): boolean {
        const block = blocks.value[blockIndex]
        if (!block) return false
        return (side === 'ours' ? block.pickOursLines : block.pickTheirsLines)[lineIndex] ?? false
    }

    /** Force-take a whole side of one block (used by the output placeholder — never un-takes). */
    function takeBlockSide(side: Side, blockIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        ;(side === 'ours' ? block.pickOursLines : block.pickTheirsLines).fill(true)
        setCurrent(blockIndex)
    }

    /** Take both sides of one block (ours lines first, then theirs — same order as the output). */
    function takeBoth(blockIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        block.pickOursLines.fill(true)
        block.pickTheirsLines.fill(true)
        setCurrent(blockIndex)
    }

    /** True when this side is fully picked in every block (whole-file select-all state). */
    function allPickedFor(side: Side): boolean {
        const withLines = blocks.value.filter(b => b[side].length > 0)
        if (!withLines.length) return false
        return withLines.every(b => (side === 'ours' ? b.pickOursLines : b.pickTheirsLines).every(Boolean))
    }

    /** Whole-file toggle: take every line of this side in every block (clear when already all taken). */
    function toggleAllPicks(side: Side) {
        const take = !allPickedFor(side)
        for (const block of blocks.value) {
            const lines = side === 'ours' ? block.pickOursLines : block.pickTheirsLines
            lines.fill(take)
        }
    }

    async function saveResolved() {
        if (!props.file) return
        const path = props.file.path
        const content = manualOutput.value ?? resultContent.value
        try {
            await uiTransient.withBusy(async () => {
                await window.api.saveResolvedFile(path, content)
                await props.refresh?.()
            }, 'Resolving…')
            notify(`${path}: conflicts resolved`, 'success')
            // the overlay closes itself — the store watch clears selectedConflict once
            // the file no longer reports unmerged
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function markResolved() {
        if (!props.file) return
        const path = props.file.path
        try {
            await uiTransient.withBusy(async () => {
                await window.api.markResolved([path])
                await props.refresh?.()
            }, 'Marking resolved…')
            notify(`${path}: marked resolved`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function takeSide(side: 'ours' | 'theirs') {
        if (!props.file) return
        const path = props.file.path
        try {
            await uiTransient.withBusy(async () => {
                await window.api.conflictTakeSide(path, side)
                await props.refresh?.()
            }, 'Resolving…')
            notify(`${path}: kept ${side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel}`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    // ---- 2 panes (ours | theirs) ----

    type Side = 'ours' | 'theirs'

    function toCtxLines(text: string | null): DiffLine[] {
        if (text === null) return []
        const lines = text.split('\n')
        if (lines.length && lines[lines.length - 1] === '') lines.pop()
        return lines.map((text, idx) => ({ type: 'ctx', oldNo: idx + 1, newNo: null, text: ` ${text}` }))
    }

    const paneLines = computed<Record<Side, DiffLine[]>>(() => ({
        ours: toCtxLines(versions.value?.ours ?? null),
        theirs: toCtxLines(versions.value?.theirs ?? null),
    }))

    /** Where a line sits inside its block — drives the GitKraken-style rounded block outline. */
    type BlockEdge = 'top' | 'bottom' | 'only'

    /**
     * Per-line block metadata precomputed from block geometry (matchIdx + lengths). Deliberately never reads the per-line picks, so
     * toggling a checkbox does NOT re-run this — per-line template work stays O(1) instead of O(blocks).
     */
    const paneMeta = computed<
        Record<Side, { block: number[]; start: boolean[]; lineInBlock: number[]; edge: (BlockEdge | null)[]; prefix: Float64Array }>
    >(() => {
        const build = (side: Side, lines: DiffLine[]) => {
            const block = Array.from<number>({ length: lines.length }).fill(-1)
            const start = Array.from<boolean>({ length: lines.length }).fill(false)
            const lineInBlock = Array.from<number>({ length: lines.length }).fill(-1)
            const edge = Array.from<BlockEdge | null>({ length: lines.length }).fill(null)
            for (let bi = 0; bi < blocks.value.length; bi++) {
                const b = blocks.value[bi]
                const from = b.matchIdx[side]
                if (from < 0) continue
                for (let i = from; i < from + b[side].length && i < block.length; i++) {
                    block[i] = bi
                    lineInBlock[i] = i - from
                    if (i === from) edge[i] = b[side].length === 1 ? 'only' : 'top'
                    else if (i === from + b[side].length - 1) edge[i] = 'bottom'
                }
                if (from < start.length) start[from] = true
            }
            // Row heights for virtualization: base line-height plus the block-outline borders
            // and the full-width "Use side" banner bar on the first row of each block.
            const heights = new Float64Array(lines.length)
            for (let i = 0; i < lines.length; i++) {
                let h = CONFLICT_ROW_H
                if (edge[i] === 'top' || edge[i] === 'only') h += CONFLICT_BORDER_H + (start[i] ? BLOCK_BANNER_H : 0)
                if (edge[i] === 'bottom' || edge[i] === 'only') h += CONFLICT_BORDER_H
                heights[i] = h
            }
            return { block, start, lineInBlock, edge, prefix: buildPrefix(heights) }
        }
        return { ours: build('ours', paneLines.value.ours), theirs: build('theirs', paneLines.value.theirs) }
    })

    const paneEls: Record<Side, HTMLElement | null> = { ours: null, theirs: null }
    const outputEl = ref<HTMLElement | null>(null)
    function setPaneRef(side: Side) {
        return (el: unknown) => {
            paneEls[side] = (el as HTMLElement | null) ?? null
        }
    }

    // ---- virtual windows (prefix offsets; rows have non-uniform heights on block edges) ----

    const paneScrollTop = ref<Record<Side, number>>({ ours: 0, theirs: 0 })
    const outputScrollTop = ref(0)
    const paneViewportH = ref(0)
    const outputViewportH = ref(0)

    /** Content offset of the rows inside a pane scroller: the sticky .pane-head sits above them. */
    function paneHeadOffset(el: HTMLElement): number {
        return el.querySelector<HTMLElement>('.pane-head')?.offsetHeight ?? 0
    }

    const oursWindow = computed(() => {
        const el = paneEls.ours
        const headH = el ? paneHeadOffset(el) : 0
        return windowFor(paneMeta.value.ours.prefix, paneScrollTop.value.ours - headH, paneViewportH.value, OVERSCAN_PX, 600)
    })
    const theirsWindow = computed(() => {
        const el = paneEls.theirs
        const headH = el ? paneHeadOffset(el) : 0
        return windowFor(paneMeta.value.theirs.prefix, paneScrollTop.value.theirs - headH, paneViewportH.value, OVERSCAN_PX, 600)
    })
    /**
     * Display rows for the output pane. Resolved blocks and common context render as code lines; fully unresolved blocks collapse their raw
     * `<<<<<<< / ======= / >>>>>>>` markers into a single placeholder card with quick-take actions (the underlying resultContent keeps the
     * raw markers so saving stays impossible until resolved).
     */
    interface OutputDisplayLine {
        kind: 'line'
        text: string
        block: number
    }
    interface OutputDisplayGap {
        kind: 'gap'
        block: number
        oursN: number
        theirsN: number
    }
    type OutputDisplayRow = OutputDisplayLine | OutputDisplayGap
    const outputDisplay = computed<OutputDisplayRow[]>(() => {
        const lines = worktree.value.split('\n')
        const out: OutputDisplayRow[] = []
        let blockIdx = 0
        let i = 0
        while (i < lines.length) {
            if (!MARK_OURS.test(lines[i])) {
                out.push({ kind: 'line', text: lines[i], block: -1 })
                i++
                continue
            }
            const idx = blockIdx++
            const block = blocks.value[idx]
            while (i < lines.length && !MARK_THEIRS.test(lines[i])) i++
            if (i < lines.length) i++ // skip >>>>>>> line
            const picked = !!block && (block.pickOursLines.some(Boolean) || block.pickTheirsLines.some(Boolean))
            if (block && picked) {
                block.ours.forEach((text, li) => {
                    if (block.pickOursLines[li]) out.push({ kind: 'line', text, block: idx })
                })
                block.theirs.forEach((text, li) => {
                    if (block.pickTheirsLines[li]) out.push({ kind: 'line', text, block: idx })
                })
            } else {
                out.push({ kind: 'gap', block: idx, oursN: block?.ours.length ?? 0, theirsN: block?.theirs.length ?? 0 })
            }
        }
        return out
    })
    const outputPrefix = computed(() => {
        const heights = new Float64Array(outputDisplay.value.length)
        for (let r = 0; r < outputDisplay.value.length; r++)
            heights[r] = outputDisplay.value[r]!.kind === 'gap' ? OUTPUT_GAP_H : CONFLICT_ROW_H
        return buildPrefix(heights)
    })
    const outputWindow = computed(() => windowFor(outputPrefix.value, outputScrollTop.value, outputViewportH.value, OVERSCAN_PX, 400))
    const outputRows = computed(() =>
        outputDisplay.value
            .slice(outputWindow.value.start, outputWindow.value.end)
            .map((row, off) => ({ row, idx: outputWindow.value.start + off }))
    )

    function sliceRows(side: Side, win: { start: number; end: number; padTop: number; padBottom: number }) {
        const lines = paneLines.value[side]
        const rows: { line: DiffLine; idx: number }[] = []
        for (let i = win.start; i < win.end && i < lines.length; i++) rows.push({ line: lines[i]!, idx: i })
        return { rows, padTop: win.padTop, padBottom: win.padBottom }
    }

    // Sequential tokenizer state per pane line — lets the template highlight only visible lines.
    const lineStatesBySide = computed<Record<Side, LineRenderContext[]>>(() => ({
        ours: computeLineStates(paneLines.value.ours, props.file?.path ?? ''),
        theirs: computeLineStates(paneLines.value.theirs, props.file?.path ?? ''),
    }))

    function paneHtmlFor(side: Side, line: DiffLine, idx: number): string {
        const cache = paneHtmlCache[side]
        const cached = cache.get(line)
        if (cached !== undefined) return cached
        const context = lineStatesBySide.value[side][idx]
        const html = highlightLineAt(line, context ?? computeLineStates([line], props.file?.path ?? '')[0]!, (_line, highlight) =>
            highlight(line.text.slice(1))
        )
        cache.set(line, html)
        return html
    }

    /** Keep the window-driving scroll refs in step with the actual DOM (clamps, programmatic scrolls). */
    function syncScrollState() {
        for (const side of Object.keys(paneEls) as Side[]) {
            const el = paneEls[side]
            if (el) paneScrollTop.value[side] = el.scrollTop
        }
        if (outputEl.value) outputScrollTop.value = outputEl.value.scrollTop
        const paneEl = paneEls.ours ?? paneEls.theirs
        paneViewportH.value = paneEl?.clientHeight ?? 0
        outputViewportH.value = outputEl.value?.clientHeight ?? 0
    }

    watch([paneLines, resultLines, () => ui.conflictOutputHeight, isFullscreen], () => nextTick(syncScrollState))

    const panes = computed(() => [
        {
            side: 'ours' as Side,
            title: 'OURS',
            label: repoStore.oursLabel,
            ...sliceRows('ours', oursWindow.value),
            meta: paneMeta.value.ours,
            exists: versions.value !== null && versions.value.ours !== null,
        },
        {
            side: 'theirs' as Side,
            title: 'THEIRS',
            label: repoStore.theirsLabel,
            ...sliceRows('theirs', theirsWindow.value),
            meta: paneMeta.value.theirs,
            exists: versions.value !== null && versions.value.theirs !== null,
        },
    ])

    let syncing = false

    /** Record a scroller's actual scrollTop so its virtual window follows (even programmatic scrolls). */
    function trackScroll(el: HTMLElement) {
        if (el === outputEl.value) {
            outputScrollTop.value = el.scrollTop
            return
        }
        for (const side of Object.keys(paneEls) as Side[]) {
            if (paneEls[side] === el) {
                paneScrollTop.value[side] = el.scrollTop
                return
            }
        }
    }

    /**
     * All three views scroll together (like GitKraken's merge tool). The output pane has a different line count than the top panes, so sync
     * is proportional (scroll ratio), not pixel-exact — for the two top panes (identical heights) the ratio still lands on the same
     * pixels.
     */
    function onPaneScroll(event: Event) {
        const source = event.target as HTMLElement
        trackScroll(source)
        if (syncing) return
        const sourceMax = source.scrollHeight - source.clientHeight
        if (sourceMax <= 0) return
        const ratio = source.scrollTop / sourceMax
        syncing = true
        const targets = [...(Object.keys(paneEls) as Side[]).map(side => paneEls[side]), outputEl.value]
        for (const el of targets) {
            if (!el || el === source) continue
            const targetMax = el.scrollHeight - el.clientHeight
            const top = targetMax > 0 ? ratio * targetMax : 0
            el.scrollTop = top
            trackScroll(el)
        }
        // horizontal scroll stays pixel-exact between the two top panes (same content shape)
        const sides = Object.keys(paneEls) as Side[]
        const sourceSide = sides.find(side => paneEls[side] === source)
        if (sourceSide) {
            const other = paneEls[sourceSide === 'ours' ? 'theirs' : 'ours']
            if (other && other.scrollLeft !== source.scrollLeft) other.scrollLeft = source.scrollLeft
        }
        requestAnimationFrame(() => {
            syncing = false
        })
    }

    function setCurrent(blockIndex: number) {
        currentBlock.value = blockIndex
    }

    function goToConflict(delta: number) {
        const count = blocks.value.length
        if (!count) return
        const from = currentBlock.value < 0 ? (delta > 0 ? -1 : 0) : currentBlock.value
        currentBlock.value = (((from + delta) % count) + count) % count
        scrollToBlock(currentBlock.value)
    }

    function scrollToBlock(blockIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        // exact per-view positioning via prefix offsets — suppress scroll-sync feedback while doing it
        syncing = true
        for (const side of Object.keys(paneEls) as Side[]) {
            const el = paneEls[side]
            const start = block.matchIdx[side]
            if (!el) continue
            if (start < 0) {
                el.scrollTop = 0
                paneScrollTop.value[side] = 0
                continue
            }
            const prefix = paneMeta.value[side].prefix
            if (start >= prefix.length - 1) continue
            // the sticky .pane-head sits above the rows inside the scroller
            const top = Math.max(0, paneHeadOffset(el) + prefix[start]! - el.clientHeight / 3)
            el.scrollTop = top
            paneScrollTop.value[side] = top
        }
        const firstOut = outputDisplay.value.findIndex(row => row.block === blockIndex)
        const out = outputEl.value
        if (out && firstOut >= 0 && manualOutput.value === null && firstOut < outputPrefix.value.length - 1) {
            const top = Math.max(0, outputPrefix.value[firstOut]! - out.clientHeight / 3)
            out.scrollTop = top
            outputScrollTop.value = top
        }
        requestAnimationFrame(() => {
            syncing = false
        })
    }

    // ---- output pane resizing (height persists via ui store, like the other splitters) ----

    const conflictMainEl = ref<HTMLElement | null>(null)

    function startOutputResize(event: MouseEvent) {
        event.preventDefault()
        const startY = event.clientY
        const startPct = ui.conflictOutputHeight
        const containerH = conflictMainEl.value?.clientHeight ?? 1
        const onMove = (moveEvent: MouseEvent) => {
            ui.conflictOutputHeight = Math.min(70, Math.max(15, startPct + ((startY - moveEvent.clientY) / containerH) * 100))
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
</script>

<template>
    <div
        v-if="!file"
        class="diff-view empty"
        :class="{ fullscreen: isFullscreen }">
        <p>เลือกไฟล์ที่มี conflict เพื่อแก้ไข</p>
    </div>
    <div
        v-else
        class="diff-view conflict-view"
        :class="{ fullscreen: isFullscreen }">
        <div class="diff-header">
            <strong>{{ file.path }}</strong>
            <span class="diff-source">· conflict</span>
            <span
                v-if="loading"
                class="muted"
                >loading…</span
            >
            <div class="diff-header-center">
                <div class="diff-nav">
                    <button
                        class="icon-btn"
                        :disabled="!blocks.length"
                        title="Previous conflict"
                        @click="goToConflict(-1)">
                        <i-lucide-arrow-up
                            width="15"
                            height="15" />
                    </button>
                    <span
                        class="chip diff-nav-counter"
                        :class="{ empty: !blocks.length }"
                        :title="navTitle"
                        >{{ navLabel }}</span
                    >
                    <button
                        class="icon-btn"
                        :disabled="!blocks.length"
                        title="Next conflict"
                        @click="goToConflict(1)">
                        <i-lucide-arrow-down
                            width="15"
                            height="15" />
                    </button>
                </div>
                <div
                    v-if="!loading && !blocks.length && versions && !versions.binary"
                    class="conflict-header">
                    <button
                        class="detail-action"
                        title="I resolved this file outside the app — stage it as resolved"
                        @click="markResolved()">
                        <i-lucide-check
                            width="12"
                            height="12" />
                        Mark resolved
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
                        title="Close conflict view"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </div>
            </div>
        </div>

        <div
            ref="conflictMainEl"
            class="diff-main conflict-main">
            <div
                v-if="loading"
                class="diff-loading">
                <div class="busy-card">
                    <ThinkSpinner suffix="Loading conflict…" />
                </div>
            </div>

            <div
                v-else-if="versions?.binary"
                class="conflict-binary">
                <p>Binary file conflict — content cannot be merged</p>
                <div class="conflict-block-actions">
                    <button
                        class="detail-action"
                        @click="takeSide('ours')">
                        Keep {{ repoStore.oursLabel }}
                    </button>
                    <button
                        class="detail-action"
                        @click="takeSide('theirs')">
                        Keep {{ repoStore.theirsLabel }}
                    </button>
                </div>
            </div>

            <div
                v-else-if="!blocks.length"
                class="conflict-binary">
                <p>No conflict markers in this file — it is still marked unmerged</p>
                <div class="conflict-block-actions">
                    <button
                        class="detail-action"
                        @click="takeSide('ours')">
                        Keep {{ repoStore.oursLabel }}
                    </button>
                    <button
                        class="detail-action"
                        @click="takeSide('theirs')">
                        Keep {{ repoStore.theirsLabel }}
                    </button>
                </div>
            </div>

            <template v-else>
                <div class="conflict-2pane">
                    <div
                        v-for="pane in panes"
                        :key="pane.side"
                        :ref="setPaneRef(pane.side)"
                        class="conflict-pane"
                        :class="[pane.side, { missing: !pane.exists }]"
                        @scroll.passive="onPaneScroll">
                        <div class="pane-head">
                            <span
                                v-if="pane.exists"
                                class="pane-head-all">
                                <button
                                    class="conflict-check"
                                    :class="{ picked: allPickedFor(pane.side) }"
                                    :title="`Take every ${pane.label} line of every conflict`"
                                    @click="toggleAllPicks(pane.side)">
                                    <i-lucide-check
                                        v-if="allPickedFor(pane.side)"
                                        width="10"
                                        height="10" />
                                </button>
                            </span>
                            <span class="pane-title">{{ pane.title }}</span>
                            <span class="pane-label">{{ pane.label }}</span>
                        </div>
                        <div
                            v-if="!pane.exists"
                            class="pane-empty">
                            (this side deleted the file)
                        </div>
                        <template v-else>
                            <div
                                class="diff-spacer"
                                :style="{ height: `${pane.padTop}px` }" />
                            <div
                                v-for="row in pane.rows"
                                :key="row.idx"
                                class="diff-line ctx conflict-line"
                                :class="{
                                    hl: pane.meta.block[row.idx] >= 0,
                                    current: pane.meta.block[row.idx] >= 0 && pane.meta.block[row.idx] === currentBlock,
                                    'blk-top': pane.meta.edge[row.idx] === 'top' || pane.meta.edge[row.idx] === 'only',
                                    'blk-bottom': pane.meta.edge[row.idx] === 'bottom' || pane.meta.edge[row.idx] === 'only',
                                }"
                                @click="pane.meta.block[row.idx] >= 0 && setCurrent(pane.meta.block[row.idx])">
                                <button
                                    v-if="pane.meta.start[row.idx]"
                                    class="block-use-btn"
                                    :class="{ active: isPicked(pane.side, pane.meta.block[row.idx]) }"
                                    :title="`Use every ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} line of this conflict`"
                                    @click.stop="togglePick(pane.side, pane.meta.block[row.idx])">
                                    {{ blockUseLabel(pane.side, pane.meta.block[row.idx]) }}
                                </button>
                                <span class="ck-all">
                                    <button
                                        v-if="pane.meta.block[row.idx] >= 0 && pane.meta.start[row.idx]"
                                        class="conflict-check"
                                        :class="{ picked: isPicked(pane.side, pane.meta.block[row.idx]) }"
                                        :title="`Use the whole ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} side of this conflict`"
                                        @click.stop="togglePick(pane.side, pane.meta.block[row.idx])">
                                        <i-lucide-check
                                            v-if="isPicked(pane.side, pane.meta.block[row.idx])"
                                            width="10"
                                            height="10" />
                                    </button>
                                </span>
                                <span class="ln">{{ row.idx + 1 }}</span>
                                <span class="ck">
                                    <button
                                        v-if="pane.meta.block[row.idx] >= 0"
                                        class="conflict-check"
                                        :class="{
                                            picked: isLinePicked(pane.side, pane.meta.block[row.idx], pane.meta.lineInBlock[row.idx]),
                                        }"
                                        :title="`Include this ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} line in the output`"
                                        @click.stop="toggleLine(pane.side, pane.meta.block[row.idx], pane.meta.lineInBlock[row.idx])">
                                        <i-lucide-check
                                            v-if="isLinePicked(pane.side, pane.meta.block[row.idx], pane.meta.lineInBlock[row.idx])"
                                            width="10"
                                            height="10" />
                                    </button>
                                </span>
                                <!-- eslint-disable-next-line vue/no-v-html -->
                                <pre v-html="paneHtmlFor(pane.side, row.line, row.idx)" />
                            </div>
                            <div
                                class="diff-spacer"
                                :style="{ height: `${pane.padBottom}px` }" />
                        </template>
                    </div>
                </div>

                <div
                    class="conflict-splitter"
                    title="Drag to resize the output pane"
                    @mousedown="startOutputResize" />

                <div
                    class="conflict-output"
                    :style="{ flexBasis: `${ui.conflictOutputHeight}%` }">
                    <div class="pane-head">
                        <span class="pane-title">OUTPUT</span>
                        <span
                            v-if="manualOutput !== null"
                            class="pane-label"
                            >edited by hand — picks won't update this</span
                        >
                        <span
                            v-else
                            class="pane-label"
                            >merged result</span
                        >
                        <span
                            class="chip conflict-chip"
                            :class="{ ok: !unresolvedCount }">
                            {{ unresolvedCount ? `${unresolvedCount} unresolved` : 'all picked' }}
                        </span>
                    </div>
                    <textarea
                        v-if="manualOutput !== null"
                        ref="outputEl"
                        v-model="manualOutput"
                        class="output-edit"
                        spellcheck="false"
                        @scroll.passive="onPaneScroll" />
                    <div
                        v-else
                        ref="outputEl"
                        class="output-body"
                        @scroll.passive="onPaneScroll">
                        <div
                            class="diff-spacer"
                            :style="{ height: `${outputWindow.padTop}px` }" />
                        <template
                            v-for="row in outputRows"
                            :key="row.idx">
                            <div
                                v-if="row.row.kind === 'gap'"
                                class="out-gap"
                                :class="{ 'out-current': row.row.block === currentBlock }"
                                @click="setCurrent(row.row.block)">
                                <span class="out-gap-label">Unresolved conflict {{ row.row.block + 1 }} — pick a side</span>
                                <span class="out-gap-sub">{{ row.row.oursN + row.row.theirsN }} lines hidden</span>
                                <span class="out-gap-actions">
                                    <button
                                        class="out-gap-btn"
                                        :title="`Take every ${repoStore.oursLabel} line of conflict ${row.row.block + 1}`"
                                        @click.stop="takeBlockSide('ours', row.row.block)">
                                        {{ repoStore.oursLabel }}
                                    </button>
                                    <button
                                        class="out-gap-btn"
                                        title="Take both sides (ours first, then theirs)"
                                        @click.stop="takeBoth(row.row.block)">
                                        Both
                                    </button>
                                    <button
                                        class="out-gap-btn"
                                        :title="`Take every ${repoStore.theirsLabel} line of conflict ${row.row.block + 1}`"
                                        @click.stop="takeBlockSide('theirs', row.row.block)">
                                        {{ repoStore.theirsLabel }}
                                    </button>
                                </span>
                            </div>
                            <div
                                v-else
                                class="diff-line ctx output-line"
                                :class="{
                                    'out-hl': row.row.block >= 0,
                                    'out-current': row.row.block >= 0 && row.row.block === currentBlock,
                                }">
                                <span class="ln">{{ row.idx + 1 }}</span>
                                <!-- eslint-disable-next-line vue/no-v-html -->
                                <pre v-html="outputHtmlFor(row.idx)" />
                            </div>
                        </template>
                        <div
                            class="diff-spacer"
                            :style="{ height: `${outputWindow.padBottom}px` }" />
                    </div>
                </div>

                <div class="conflict-footer">
                    <button
                        class="footer-btn footer-reset"
                        title="Discard manual edits — let the picks drive the output again"
                        @click="discardManualEdit()">
                        <i-lucide-rotate-ccw
                            width="12"
                            height="12" />
                        Reset
                    </button>
                    <button
                        class="footer-btn footer-edit"
                        :disabled="manualOutput !== null"
                        title="Edit the output by hand"
                        @click="startManualEdit()">
                        <i-lucide-pencil
                            width="12"
                            height="12" />
                        Edit manual
                    </button>
                    <div
                        class="conflict-progress"
                        :title="`${resolvedCount} of ${blocks.length} conflicts resolved`">
                        <div
                            class="conflict-progress-fill"
                            :style="{ width: `${progressPct}%` }" />
                    </div>
                    <span class="footer-count">{{ resolvedCount }}/{{ blocks.length }} resolved</span>
                    <button
                        class="footer-btn footer-save"
                        :disabled="!canSave"
                        :title="canSave ? 'Write the resolved file and stage it' : 'Pick at least one side for every conflict'">
                        <i-lucide-save
                            width="12"
                            height="12" />
                        Save &amp; resolve
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>
