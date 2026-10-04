import { describe, expect, it } from 'vitest'

import { buildSplitPlan, splitRowAt } from '../../src/renderer/src/utils/diffPlan'

import type { DiffLine } from '../../src/shared/types'

/**
 * Reference implementation of the split-view row mapping — deliberately a second, simple version of the
 * algorithm. The parity fuzz below locks the segment-plan version to it, including the intentional behavior
 * change where meta rows render as separators (they used to be skipped).
 */
function referenceRows(lines: DiffLine[]): { left?: DiffLine; right?: DiffLine; hunkHeader?: DiffLine; change?: number }[] {
    const rows: { left?: DiffLine; right?: DiffLine; hunkHeader?: DiffLine; change?: number }[] = []
    let change = 0
    let inChange = false
    let i = 0
    while (i < lines.length) {
        const current = lines[i]!
        if (current.type === 'meta') {
            rows.push({ hunkHeader: current })
            i++
            continue
        }
        if (current.type === 'hunk') {
            rows.push({ hunkHeader: current })
            inChange = false
            i++
            continue
        }
        if (current.type !== 'del') {
            if (current.type === 'add') {
                rows.push({ right: current, change: inChange ? undefined : change++ })
                inChange = true
                i++
                continue
            }
            const ctx = current.type === 'ctx' ? current : undefined
            rows.push({ left: ctx, right: ctx })
            inChange = false
            i++
            continue
        }
        const dels: DiffLine[] = []
        while (i < lines.length && lines[i]!.type === 'del') dels.push(lines[i++]!)
        const adds: DiffLine[] = []
        while (i < lines.length && lines[i]!.type === 'add') adds.push(lines[i++]!)
        const leftPad = Math.max(0, adds.length - dels.length)
        const rightPad = Math.max(0, dels.length - adds.length)
        const at = (arr: DiffLine[], index: number): DiffLine | undefined => (index >= 0 && index < arr.length ? arr[index] : undefined)
        for (let p = 0; p < Math.max(dels.length, adds.length); p++) {
            const row: { left?: DiffLine; right?: DiffLine; change?: number } = {
                left: at(dels, p - leftPad),
                right: at(adds, p - rightPad),
            }
            if (!inChange) {
                row.change = change++
                inChange = true
            }
            rows.push(row)
        }
    }
    return rows
}

function mulberry32(seed: number) {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const TYPES: DiffLine['type'][] = ['ctx', 'add', 'del', 'hunk', 'meta']

describe('split plan parity', () => {
    it('matches the reference row mapping on random diffs', () => {
        const random = mulberry32(12345)
        for (let iteration = 0; iteration < 400; iteration++) {
            const length = Math.floor(random() * 40)
            const lines: DiffLine[] = []
            for (let k = 0; k < length; k++) {
                const type = TYPES[Math.floor(random() * TYPES.length)]!
                lines.push({ type, text: `${type}-${k}`, oldNo: k, newNo: k })
            }

            const expected = referenceRows(lines)
            const plan = buildSplitPlan(lines)
            expect(plan.totalRows).toBe(expected.length)

            for (let row = 0; row < expected.length; row++) {
                const got = splitRowAt(plan, row)
                const want = expected[row]!
                expect({
                    left: got.left,
                    right: got.right,
                    hunkHeader: got.hunkHeader,
                    change: got.change,
                }).toEqual({ left: want.left, right: want.right, hunkHeader: want.hunkHeader, change: want.change })
            }

            // lineRows must point at the first row where the line appears on either side.
            for (let index = 0; index < lines.length; index++) {
                const source = lines[index]!
                if (source.type === 'hunk' || source.type === 'meta') {
                    expect(plan.lineRows[index]).toBe(-1)
                    continue
                }
                const firstRow = expected.findIndex(row => row.left === source || row.right === source)
                expect(plan.lineRows[index]).toBe(firstRow)
            }

            // changeRows lists exactly the rows carrying a change number.
            const expectedChangeRows = expected.flatMap((row, index) => (row.change !== undefined ? [index] : []))
            expect(plan.changeRows).toEqual(expectedChangeRows)
        }
    })

    it('pads the shorter side of an uneven change block', () => {
        const lines: DiffLine[] = [
            { type: 'del', text: '-a', oldNo: 1, newNo: null },
            { type: 'add', text: '+b', oldNo: null, newNo: 1 },
            { type: 'add', text: '+c', oldNo: null, newNo: 2 },
        ]
        const plan = buildSplitPlan(lines)
        expect(plan.totalRows).toBe(2)
        // The shorter side is padded at the top of the block (adds longer than dels).
        expect(splitRowAt(plan, 0)).toMatchObject({ left: undefined, right: lines[1], change: 0 })
        expect(splitRowAt(plan, 1)).toMatchObject({ left: lines[0], right: lines[2], change: undefined })
        expect(plan.lineRows[0]).toBe(1)
        expect(plan.lineRows[1]).toBe(0)
        expect(plan.lineRows[2]).toBe(1)
    })
})
