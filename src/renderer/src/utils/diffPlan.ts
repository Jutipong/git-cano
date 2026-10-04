import { buildPrefix, indexAtOffset } from './virtual'

import type { DiffLine } from '@shared/types'

/**
 * Split-view row planning, extracted from DiffView so it can be unit-tested (see tests/unit/diffPlan.test.ts).
 * The diff is grouped into hunk / context-run / change-run segments, so the side-by-side layout is resolved per
 * visible row instead of materializing one row wrapper per line — whole-file views of large files would otherwise
 * allocate a second array of row objects on top of the DiffLine array itself.
 */

export interface SideBySideRow {
    left?: DiffLine
    right?: DiffLine
    hunkHeader?: DiffLine
    change?: number
    /** Source line index per side — tokenizer contexts are keyed by line index, not row index. */
    leftIndex?: number
    rightIndex?: number
}

export interface SplitCtxSegment {
    kind: 'ctx'
    lines: DiffLine[]
    /** Index of the first line in the source `lines` array. */
    lineStart: number
}

export interface SplitChangeSegment {
    kind: 'change'
    dels: DiffLine[]
    adds: DiffLine[]
    leftPad: number
    rightPad: number
    /** Change number carried by the first row, or undefined when this run continues the previous change region. */
    change?: number
    /** Source line index of the first del / first add (-1 when the side is empty). */
    delStart: number
    addStart: number
}

export interface SplitHunkSegment {
    kind: 'hunk'
    line: DiffLine
}

export type SplitSegment = SplitCtxSegment | SplitChangeSegment | SplitHunkSegment

export interface SplitPlan {
    segments: SplitSegment[]
    /** prefix[i] = first row of segment i; prefix[segments.length] = total row count. */
    prefix: Float64Array
    totalRows: number
    /** First row of each change region (change navigation + minimap). */
    changeRows: number[]
    /** Row index per source line (-1 for hunk/meta) — search hits resolve their row through this. */
    lineRows: Int32Array
}

export function buildSplitPlan(source: DiffLine[]): SplitPlan {
    const segments: SplitSegment[] = []
    const rowCounts: number[] = []
    const lineRows = new Int32Array(source.length).fill(-1)
    let change = 0
    let inChange = false
    let i = 0
    while (i < source.length) {
        const first = source[i]!
        if (first.type === 'meta') {
            // Meta rows (diff header, truncation notice, snapshot marker) render as full-width separators in
            // split mode — inline always showed them, and the truncation marker must stay visible in both modes.
            // Deliberately does NOT reset the change run (matches the old split loop, which skipped meta only).
            segments.push({ kind: 'hunk', line: first })
            rowCounts.push(1)
            i++
            continue
        }
        if (first.type === 'hunk') {
            segments.push({ kind: 'hunk', line: first })
            rowCounts.push(1)
            inChange = false
            i++
            continue
        }
        if (first.type !== 'del' && first.type !== 'add') {
            const lineStart = i
            const run: DiffLine[] = []
            while (i < source.length) {
                const type = source[i]!.type
                if (type === 'del' || type === 'add' || type === 'hunk' || type === 'meta') break
                run.push(source[i]!)
                i++
            }
            segments.push({ kind: 'ctx', lines: run, lineStart })
            rowCounts.push(run.length)
            inChange = false
            continue
        }
        const dels: DiffLine[] = []
        const delStart = i
        while (i < source.length && source[i]!.type === 'del') dels.push(source[i++]!)
        const adds: DiffLine[] = []
        const addStart = i
        while (i < source.length && source[i]!.type === 'add') adds.push(source[i++]!)
        // Consecutive del/add runs share the previous change number unless a context/hunk row reset the
        // run (mirrors the old inline loop, which only numbered the first row of a fresh change region).
        const changeNo = inChange ? undefined : change++
        segments.push({
            kind: 'change',
            dels,
            adds,
            leftPad: Math.max(0, adds.length - dels.length),
            rightPad: Math.max(0, dels.length - adds.length),
            change: changeNo,
            delStart,
            addStart,
        })
        rowCounts.push(Math.max(dels.length, adds.length))
        inChange = true
    }
    const prefix = buildPrefix(rowCounts)
    const changeRows: number[] = []
    for (let s = 0; s < segments.length; s++) {
        const segment = segments[s]!
        const start = prefix[s]!
        if (segment.kind === 'change') {
            if (segment.change !== undefined) changeRows.push(start)
            for (let k = 0; k < segment.dels.length; k++) lineRows[segment.delStart + k] = start + segment.leftPad + k
            for (let k = 0; k < segment.adds.length; k++) lineRows[segment.addStart + k] = start + segment.rightPad + k
        } else if (segment.kind === 'ctx') {
            for (let k = 0; k < segment.lines.length; k++) lineRows[segment.lineStart + k] = start + k
        }
    }
    return { segments, prefix, totalRows: prefix[segments.length] ?? 0, changeRows, lineRows }
}

export function splitRowAt(plan: SplitPlan, index: number): SideBySideRow {
    const segmentIndex = Math.min(indexAtOffset(plan.prefix, index), plan.segments.length - 1)
    const segment = plan.segments[segmentIndex]
    if (!segment) return {}
    const offset = index - (plan.prefix[segmentIndex] ?? 0)
    if (segment.kind === 'hunk') return { hunkHeader: segment.line }
    if (segment.kind === 'ctx') {
        const line = segment.lines[offset]
        if (!line) return {}
        return { left: line, right: line, leftIndex: segment.lineStart + offset, rightIndex: segment.lineStart + offset }
    }
    const leftOffset = offset - segment.leftPad
    const rightOffset = offset - segment.rightPad
    const left = leftOffset >= 0 ? segment.dels[leftOffset] : undefined
    const right = rightOffset >= 0 ? segment.adds[rightOffset] : undefined
    return {
        left,
        right,
        change: offset === 0 ? segment.change : undefined,
        leftIndex: left ? segment.delStart + leftOffset : undefined,
        rightIndex: right ? segment.addStart + rightOffset : undefined,
    }
}
