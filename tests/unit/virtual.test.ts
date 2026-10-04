import { describe, expect, it } from 'vitest'

import { buildPrefix, indexAtOffset, windowFor } from '../../src/renderer/src/utils/virtual'

describe('buildPrefix', () => {
    it('builds cumulative offsets with a trailing total', () => {
        expect([...buildPrefix([10, 20, 30])]).toEqual([0, 10, 30, 60])
    })
})

describe('indexAtOffset', () => {
    const prefix = buildPrefix([10, 20, 30])

    it('finds the row containing an offset', () => {
        expect(indexAtOffset(prefix, 0)).toBe(0)
        expect(indexAtOffset(prefix, 9)).toBe(0)
        expect(indexAtOffset(prefix, 10)).toBe(1)
        expect(indexAtOffset(prefix, 29)).toBe(1)
        expect(indexAtOffset(prefix, 30)).toBe(2)
        expect(indexAtOffset(prefix, 999)).toBe(3)
    })
})

describe('windowFor', () => {
    const prefix = buildPrefix([20, 20, 20])

    it('returns a zero window for empty prefixes', () => {
        expect(windowFor(buildPrefix([]), 0, 100, 0, 600)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    })

    it('computes the visible range plus spacer heights', () => {
        const window = windowFor(prefix, 20, 20, 0, 600)
        expect(window.start).toBe(1)
        expect(window.end).toBe(3)
        expect(window.padTop).toBe(20)
        expect(window.padBottom).toBe(0)
    })

    it('falls back to the fallback viewport when the measured height is 0', () => {
        const window = windowFor(prefix, 0, 0, 0, 40)
        expect(window.end).toBe(3)
    })
})
