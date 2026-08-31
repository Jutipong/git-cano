<script setup lang="ts">
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
        pickOurs: boolean
        pickTheirs: boolean
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
            blocks.push({ ours, theirs, label, pickOurs: false, pickTheirs: false, matchIdx: { ours: -1, theirs: -1 } })
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
            worktree.value = content
            const parsed = parseBlocks(content, repoStore.theirsLabel)
            annotateMatches(parsed)
            blocks.value = parsed
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            loading.value = false
        }
    }

    watch(() => props.file, loadConflict, { immediate: true })

    const unresolvedCount = computed(() => blocks.value.filter(block => !block.pickOurs && !block.pickTheirs).length)
    const canSave = computed(() => blocks.value.length > 0 && unresolvedCount.value === 0)

    /**
     * The output file assembled from the picked sides; unresolved blocks keep their raw markers so they are visible (and make the
     * main-process marker validation fail).
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
            if (block && (block.pickOurs || block.pickTheirs)) {
                if (block.pickOurs) block.ours.forEach(text => out.push({ text, block: idx }))
                if (block.pickTheirs) block.theirs.forEach(text => out.push({ text, block: idx }))
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

    function togglePick(side: 'ours' | 'theirs', blockIndex: number) {
        const block = blocks.value[blockIndex]
        if (!block) return
        if (side === 'ours') block.pickOurs = !block.pickOurs
        else block.pickTheirs = !block.pickTheirs
    }

    function isPicked(side: 'ours' | 'theirs', blockIndex: number): boolean {
        const block = blocks.value[blockIndex]
        if (!block) return false
        return side === 'ours' ? block.pickOurs : block.pickTheirs
    }

    async function saveResolved() {
        if (!props.file || !canSave.value) return
        const path = props.file.path
        try {
            await uiTransient.withBusy(() => window.api.saveResolvedFile(path, resultContent.value), 'Resolving…')
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

    /**
     * Per-line block metadata precomputed from block geometry (matchIdx + lengths). Deliberately never reads pickOurs/pickTheirs, so
     * toggling a checkbox does NOT re-run this — per-line template work stays O(1) instead of O(blocks).
     */
    const paneMeta = computed<Record<Side, { block: number[]; start: boolean[] }>>(() => {
        const build = (side: Side, lines: DiffLine[]) => {
            const block = Array.from<number>({ length: lines.length }).fill(-1)
            const start = Array.from<boolean>({ length: lines.length }).fill(false)
            for (let bi = 0; bi < blocks.value.length; bi++) {
                const b = blocks.value[bi]
                const from = b.matchIdx[side]
                if (from < 0) continue
                for (let i = from; i < from + b[side].length && i < block.length; i++) block[i] = bi
                if (from < start.length) start[from] = true
            }
            return { block, start }
        }
        return { ours: build('ours', paneLines.value.ours), theirs: build('theirs', paneLines.value.theirs) }
    })

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
    function onPaneScroll(event: Event) {
        if (syncing) return
        const source = event.target as HTMLElement
        syncing = true
        for (const side of Object.keys(paneEls) as Side[]) {
            const el = paneEls[side]
            if (el && el !== source) {
                el.scrollTop = source.scrollTop
                el.scrollLeft = source.scrollLeft
            }
        }
        requestAnimationFrame(() => {
            syncing = false
        })
    }

    const navLabel = computed(() => (blocks.value.length ? `conflict ${currentBlock.value + 1} of ${blocks.value.length}` : 'no conflicts'))

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
        <p>Select a conflicted file to resolve it</p>
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
                <div class="conflict-header">
                    <span
                        v-if="blocks.length"
                        class="chip conflict-chip"
                        :class="{ ok: !unresolvedCount }">
                        {{ unresolvedCount ? `${unresolvedCount} unresolved` : 'all picked' }}
                    </span>
                    <button
                        class="detail-action accent"
                        :disabled="!canSave"
                        :title="canSave ? 'Write the resolved file and stage it' : 'Pick at least one side for every conflict'"
                        @click="saveResolved()">
                        Save
                    </button>
                    <button
                        v-if="!loading && !blocks.length && versions && !versions.binary"
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
                class="diff-empty">
                Loading conflict…
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
                                }"
                                @click="pane.meta.block[idx] >= 0 && setCurrent(pane.meta.block[idx])">
                                <span class="ck">
                                    <button
                                        v-if="pane.meta.start[idx]"
                                        class="conflict-check"
                                        :class="{ picked: isPicked(pane.side, pane.meta.block[idx]) }"
                                        :title="`Include the ${pane.side === 'ours' ? repoStore.oursLabel : repoStore.theirsLabel} side of this conflict in the output`"
                                        @click.stop="togglePick(pane.side, pane.meta.block[idx])">
                                        <i-lucide-check
                                            v-if="isPicked(pane.side, pane.meta.block[idx])"
                                            width="10"
                                            height="10" />
                                    </button>
                                </span>
                                <span class="ln">{{ idx + 1 }}</span>
                                <!-- eslint-disable-next-line vue/no-v-html -->
                                <pre v-html="htmlMaps[pane.side].get(line) ?? ''" />
                            </div>
                        </template>
                    </div>
                </div>

                <div class="conflict-nav">
                    <span class="conflict-nav-label">{{ navLabel }}</span>
                    <button
                        class="icon-btn"
                        :disabled="!blocks.length"
                        title="Previous conflict"
                        @click="goToConflict(-1)">
                        <i-lucide-chevron-up
                            width="14"
                            height="14" />
                    </button>
                    <button
                        class="icon-btn"
                        :disabled="!blocks.length"
                        title="Next conflict"
                        @click="goToConflict(1)">
                        <i-lucide-chevron-down
                            width="14"
                            height="14" />
                    </button>
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
                        <span class="pane-label">merged result</span>
                    </div>
                    <div
                        ref="outputEl"
                        class="output-body">
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
