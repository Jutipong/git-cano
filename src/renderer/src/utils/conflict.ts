/** Conflict-block parsing and pick state for `ConflictView.vue` — pure logic so it can be unit-tested. */

export type ConflictSide = 'ours' | 'theirs'

export interface ConflictBlock {
    ours: string[]
    theirs: string[]
    /** Name of the incoming side parsed from the `>>>>>>>` marker. */
    label: string
    /** Per-line picks (GitKraken-style: a hunk can be taken whole or line by line). */
    pickOursLines: boolean[]
    pickTheirsLines: boolean[]
    /**
     * Whole-side pick for a side that has no lines (the side deleted the hunk). Without it a block whose chosen side is empty can never be
     * resolved — there is no line to tick.
     */
    emptyPick: Record<ConflictSide, boolean>
    matchIdx: { ours: number; theirs: number }
}

const MARK_OURS = /^<{7}(?: (.*))?$/
const MARK_BASE = /^\|{7}(?: .*)?$/
const MARK_SEP = /^={7}$/
const MARK_THEIRS = /^>{7}(?: (.*))?$/

export function parseConflictBlocks(text: string, fallbackTheirs: string): ConflictBlock[] {
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
            emptyPick: { ours: false, theirs: false },
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

export function annotateConflictMatches(blocks: ConflictBlock[], oursText: string, theirsText: string): void {
    const oursLines = oursText.split('\n')
    const theirsLines = theirsText.split('\n')
    let fromOurs = 0
    let fromTheirs = 0
    for (const block of blocks) {
        block.matchIdx.ours = matchSequence(oursLines, block.ours, fromOurs)
        if (block.matchIdx.ours >= 0) fromOurs = block.matchIdx.ours + block.ours.length
        block.matchIdx.theirs = matchSequence(theirsLines, block.theirs, fromTheirs)
        if (block.matchIdx.theirs >= 0) fromTheirs = block.matchIdx.theirs + block.theirs.length
    }
}

function pickedLines(block: ConflictBlock, side: ConflictSide): boolean[] {
    return side === 'ours' ? block.pickOursLines : block.pickTheirsLines
}

/** True when this side of the block is chosen — at least one line, or the whole side when it has none. */
export function sidePicked(block: ConflictBlock | undefined, side: ConflictSide): boolean {
    if (!block) return false
    return pickedLines(block, side).some(Boolean) || block.emptyPick[side]
}

/** A block is resolved once either side is chosen. */
export function blockPicked(block: ConflictBlock | undefined): boolean {
    if (!block) return false
    return sidePicked(block, 'ours') || sidePicked(block, 'theirs')
}

/** Block-level pick: take (or un-take) every line of this side; an empty side flips its whole-side marker instead. */
export function toggleSidePick(block: ConflictBlock | undefined, side: ConflictSide): void {
    if (!block) return
    const lines = pickedLines(block, side)
    if (!lines.length) {
        block.emptyPick[side] = !block.emptyPick[side]
        return
    }
    lines.fill(!lines.some(Boolean))
}

export function toggleLinePick(block: ConflictBlock | undefined, side: ConflictSide, lineIndex: number): void {
    if (!block) return
    const lines = pickedLines(block, side)
    lines[lineIndex] = !lines[lineIndex]
}

export function linePicked(block: ConflictBlock | undefined, side: ConflictSide, lineIndex: number): boolean {
    if (!block) return false
    return pickedLines(block, side)[lineIndex] ?? false
}

/** Force-take a whole side of one block (never un-takes). */
export function takeSideOfBlock(block: ConflictBlock | undefined, side: ConflictSide): void {
    if (!block) return
    const lines = pickedLines(block, side)
    if (lines.length) lines.fill(true)
    else block.emptyPick[side] = true
}

/** Take both sides of one block (ours lines first, then theirs — same order as the output). */
export function takeBothSides(block: ConflictBlock | undefined): void {
    if (!block) return
    takeSideOfBlock(block, 'ours')
    takeSideOfBlock(block, 'theirs')
}

/** True when this side is fully picked in every block (whole-file select-all state). */
export function allSidesPicked(blocks: ConflictBlock[], side: ConflictSide): boolean {
    if (!blocks.length) return false
    return blocks.every(block => {
        const lines = pickedLines(block, side)
        return lines.length ? lines.every(Boolean) : block.emptyPick[side]
    })
}

/** Whole-file toggle: take every line of this side in every block (clear when already all taken). */
export function toggleAllSidePicks(blocks: ConflictBlock[], side: ConflictSide): void {
    const take = !allSidesPicked(blocks, side)
    for (const block of blocks) {
        const lines = pickedLines(block, side)
        if (lines.length) lines.fill(take)
        else block.emptyPick[side] = take
    }
}

export interface ConflictOutputLine {
    kind: 'line'
    text: string
    /** Block index this line belongs to, or -1 for common context. */
    block: number
}

/** Placeholder card that replaces a fully unresolved block's raw markers in the output pane. */
export interface ConflictOutputGap {
    kind: 'gap'
    block: number
    oursN: number
    theirsN: number
}

export type ConflictOutputRow = ConflictOutputLine | ConflictOutputGap

/**
 * The output file assembled from the picked lines (per block: ours first, then theirs); fully unresolved blocks keep their raw markers so
 * they are visible (and make the main-process marker validation fail).
 */
export function conflictOutputLines(text: string, blocks: ConflictBlock[]): ConflictOutputLine[] {
    const lines = text.split('\n')
    const out: ConflictOutputLine[] = []
    let blockIdx = 0
    let i = 0
    while (i < lines.length) {
        if (!MARK_OURS.test(lines[i])) {
            out.push({ kind: 'line', text: lines[i], block: -1 })
            i++
            continue
        }
        const idx = blockIdx++
        const block = blocks[idx]
        const start = i
        i++
        while (i < lines.length && !MARK_THEIRS.test(lines[i])) i++
        const end = i < lines.length ? i : lines.length - 1 // last marker line (or EOF)
        if (block && blockPicked(block)) {
            block.ours.forEach((lineText, li) => {
                if (block.pickOursLines[li]) out.push({ kind: 'line', text: lineText, block: idx })
            })
            block.theirs.forEach((lineText, li) => {
                if (block.pickTheirsLines[li]) out.push({ kind: 'line', text: lineText, block: idx })
            })
        } else {
            lines.slice(start, end + 1).forEach(lineText => out.push({ kind: 'line', text: lineText, block: idx }))
        }
        if (i < lines.length) i++ // skip >>>>>>> line
    }
    return out
}

/** Output-pane rows: resolved blocks render as code lines, fully unresolved blocks collapse into one placeholder card. */
export function conflictDisplayRows(text: string, blocks: ConflictBlock[]): ConflictOutputRow[] {
    const out: ConflictOutputRow[] = []
    let gapFor = -1
    for (const row of conflictOutputLines(text, blocks)) {
        if (row.block < 0 || blockPicked(blocks[row.block])) {
            out.push(row)
            continue
        }
        if (row.block === gapFor) continue
        gapFor = row.block
        const block = blocks[row.block]
        out.push({ kind: 'gap', block: row.block, oursN: block?.ours.length ?? 0, theirsN: block?.theirs.length ?? 0 })
    }
    return out
}
