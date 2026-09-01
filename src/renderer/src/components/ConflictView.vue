<script setup lang="ts">
    import { confirmDialog } from '../utils/confirm'
    import { highlightDiffLines, highlightLine } from '../utils/highlight'
    import CloseXIcon from './CloseXIcon.vue'

    import type { ToastKind } from '../stores/uiTransient'
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
    // genuinely new output lines get highlighted, the rest reuse the cached HTML string
    const outputHtmlCache = new Map<string, string>()
    const outputHtml = computed(() => {
        const path = props.file?.path ?? ''
        return resultLines.value.map(line => {
            const key = `${path}\u0000${line.text}`
            let html = outputHtmlCache.get(key)
            if (html === undefined) {
                html = highlightLine(line.text, path)
                outputHtmlCache.set(key, html)
            }
            return html
        })
    })

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
            await uiTransient.withBusy(() => window.api.saveResolvedFile(path, content), 'Resolving…')
            await props.refresh?.()
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
            await uiTransient.withBusy(() => window.api.markResolved([path]), 'Marking resolved…')
            await props.refresh?.()
            notify(`${path}: marked resolved`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function takeSide(side: 'ours' | 'theirs') {
        if (!props.file) return
        const path = props.file.path
        try {
            await uiTransient.withBusy(() => window.api.conflictTakeSide(path, side), 'Resolving…')
            await props.refresh?.()
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

    const htmlMaps = computed<Record<Side, Map<DiffLine, string>>>(() => ({
        ours: highlightDiffLines(paneLines.value.ours, props.file?.path ?? '', (line, highlight) => highlight(line.text.slice(1))),
        theirs: highlightDiffLines(paneLines.value.theirs, props.file?.path ?? '', (line, highlight) => highlight(line.text.slice(1))),
    }))

    /** Where a line sits inside its block — drives the GitKraken-style rounded block outline. */
    type BlockEdge = 'top' | 'bottom' | 'only'

    /**
     * Per-line block metadata precomputed from block geometry (matchIdx + lengths). Deliberately never reads the per-line picks, so
     * toggling a checkbox does NOT re-run this — per-line template work stays O(1) instead of O(blocks).
     */
    const paneMeta = computed<Record<Side, { block: number[]; start: boolean[]; lineInBlock: number[]; edge: (BlockEdge | null)[] }>>(
        () => {
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
                return { block, start, lineInBlock, edge }
            }
            return { ours: build('ours', paneLines.value.ours), theirs: build('theirs', paneLines.value.theirs) }
        }
    )

    const panes = computed(() => [
        {
            side: 'ours' as Side,
            title: 'OURS',
            label: repoStore.oursLabel,
            lines: paneLines.value.ours,
            meta: paneMeta.value.ours,
            exists: versions.value !== null && versions.value.ours !== null,
        },
        {
            side: 'theirs' as Side,
            title: 'THEIRS',
            label: repoStore.theirsLabel,
            lines: paneLines.value.theirs,
            meta: paneMeta.value.theirs,
            exists: versions.value !== null && versions.value.theirs !== null,
        },
    ])

    const paneEls: Record<Side, HTMLElement | null> = { ours: null, theirs: null }
    const outputEl = ref<HTMLElement | null>(null)
    function setPaneRef(side: Side) {
        return (el: unknown) => {
            paneEls[side] = (el as HTMLElement | null) ?? null
        }
    }

    let syncing = false

    /**
     * All three views scroll together (like GitKraken's merge tool). The output pane has a different line count than the top panes, so sync
     * is proportional (scroll ratio), not pixel-exact — for the two top panes (identical heights) the ratio still lands on the same
     * pixels.
     */
    function onPaneScroll(event: Event) {
        if (syncing) return
        const source = event.target as HTMLElement
        const sourceMax = source.scrollHeight - source.clientHeight
        if (sourceMax <= 0) return
        const ratio = source.scrollTop / sourceMax
        syncing = true
        const targets = [...(Object.keys(paneEls) as Side[]).map(side => paneEls[side]), outputEl.value]
        for (const el of targets) {
            if (!el || el === source) continue
            const targetMax = el.scrollHeight - el.clientHeight
            el.scrollTop = targetMax > 0 ? ratio * targetMax : 0
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
        // exact per-view positioning — suppress scroll-sync feedback while doing it
        syncing = true
        for (const side of Object.keys(paneEls) as Side[]) {
            const el = paneEls[side]
            const start = block.matchIdx[side]
            if (!el) continue
            if (start < 0) {
                el.scrollTop = 0
                continue
            }
            const lineEl = el.querySelectorAll('.diff-line')[start] as HTMLElement | undefined
            if (lineEl) el.scrollTop = Math.max(0, lineEl.offsetTop - el.clientHeight / 3)
        }
        const firstOut = resultLines.value.findIndex(line => line.block === blockIndex)
        const out = outputEl.value
        if (out && firstOut >= 0) {
            const lineEl = out.querySelectorAll('.diff-line')[firstOut] as HTMLElement | undefined
            if (lineEl) out.scrollTop = Math.max(0, lineEl.offsetTop - out.clientHeight / 3)
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
                >กำลังโหลด…</span
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
                    <span class="chip diff-nav-counter">{{ blocks.length ? currentBlock + 1 : 0 }}/{{ blocks.length }}</span>
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
                    <i-lucide-loader-circle
                        class="spinning"
                        width="18"
                        height="18" />
                    <span>Loading conflict…</span>
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
                                v-for="(line, idx) in pane.lines"
                                :key="idx"
                                class="diff-line ctx conflict-line"
                                :class="{
                                    hl: pane.meta.block[idx] >= 0,
                                    current: pane.meta.block[idx] >= 0 && pane.meta.block[idx] === currentBlock,
                                    'blk-top': pane.meta.edge[idx] === 'top' || pane.meta.edge[idx] === 'only',
                                    'blk-bottom': pane.meta.edge[idx] === 'bottom' || pane.meta.edge[idx] === 'only',
                                }"
                                @click="pane.meta.block[idx] >= 0 && setCurrent(pane.meta.block[idx])">
                                <button
                                    v-if="pane.meta.start[idx]"
                                    class="block-use-btn"
                                    :title="`Use every ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} line of this conflict`"
                                    @click.stop="togglePick(pane.side, pane.meta.block[idx])">
                                    Use {{ pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel }}
                                </button>
                                <span class="ck-all">
                                    <button
                                        v-if="pane.meta.block[idx] >= 0 && pane.meta.start[idx]"
                                        class="conflict-check"
                                        :class="{ picked: isPicked(pane.side, pane.meta.block[idx]) }"
                                        :title="`Use the whole ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} side of this conflict`"
                                        @click.stop="togglePick(pane.side, pane.meta.block[idx])">
                                        <i-lucide-check
                                            v-if="isPicked(pane.side, pane.meta.block[idx])"
                                            width="10"
                                            height="10" />
                                    </button>
                                </span>
                                <span class="ln">{{ idx + 1 }}</span>
                                <span class="ck">
                                    <button
                                        v-if="pane.meta.block[idx] >= 0"
                                        class="conflict-check"
                                        :class="{ picked: isLinePicked(pane.side, pane.meta.block[idx], pane.meta.lineInBlock[idx]) }"
                                        :title="`Include this ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} line in the output`"
                                        @click.stop="toggleLine(pane.side, pane.meta.block[idx], pane.meta.lineInBlock[idx])">
                                        <i-lucide-check
                                            v-if="isLinePicked(pane.side, pane.meta.block[idx], pane.meta.lineInBlock[idx])"
                                            width="10"
                                            height="10" />
                                    </button>
                                </span>
                                <!-- eslint-disable-next-line vue/no-v-html -->
                                <pre v-html="htmlMaps[pane.side].get(line) ?? ''" />
                            </div>
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
                        <div class="segmented output-head-actions">
                            <button
                                class="output-mini-btn output-reset-btn"
                                title="Discard manual edits — let the picks drive the output again"
                                @click="discardManualEdit()">
                                <i-lucide-rotate-ccw
                                    width="12"
                                    height="12" />
                                Reset
                            </button>
                            <span class="segmented-divider" />
                            <button
                                class="output-mini-btn output-edit-btn"
                                :disabled="manualOutput !== null"
                                title="Edit the output by hand"
                                @click="startManualEdit()">
                                <i-lucide-pencil
                                    width="12"
                                    height="12" />
                                Edit Manual
                            </button>
                            <span class="segmented-divider" />
                            <span
                                class="chip conflict-chip"
                                :class="{ ok: !unresolvedCount }">
                                {{ unresolvedCount ? `${unresolvedCount} unresolved` : 'all picked' }}
                            </span>
                            <span class="segmented-divider" />
                            <button
                                class="output-mini-btn output-save-btn"
                                :disabled="!canSave"
                                :title="canSave ? 'Write the resolved file and stage it' : 'Pick at least one side for every conflict'"
                                @click="saveResolved()">
                                <i-lucide-save
                                    width="12"
                                    height="12" />
                                Save
                            </button>
                        </div>
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
                            v-for="(line, idx) in resultLines"
                            :key="idx"
                            class="diff-line ctx output-line"
                            :class="{
                                'out-hl': line.block >= 0,
                                'out-current': line.block >= 0 && line.block === currentBlock,
                                unresolved: line.block >= 0 && !isPicked('ours', line.block) && !isPicked('theirs', line.block),
                            }">
                            <span class="ln">{{ idx + 1 }}</span>
                            <!-- eslint-disable-next-line vue/no-v-html -->
                            <pre v-html="outputHtml[idx]" />
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>
