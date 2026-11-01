import { describe, expect, it } from 'vitest'

import {
    buildTerminalFontFamily,
    defaultTerminalFontFamily,
    familyDiffersFromFallback,
    isFontInstalled,
    primaryFontFamily,
    resolveTerminalFontFamily,
    terminalFontPx,
    TERMINAL_THAI_FALLBACK,
} from '../../src/renderer/src/utils/terminalFont'

const DEFAULT = `'Consolas', ${TERMINAL_THAI_FALLBACK}`

describe('defaultTerminalFontFamily', () => {
    it('leads with the platform faces and keeps a Thai fallback', () => {
        expect(defaultTerminalFontFamily(false)).toBe("'Consolas', 'Leelawadee UI', monospace")
        expect(defaultTerminalFontFamily(true)).toBe("'SF Mono', Menlo, 'Thonburi', monospace")
    })

    it('keeps Thonburi in the preset fallback so macOS picks still shape Thai', () => {
        expect(TERMINAL_THAI_FALLBACK).toContain('Thonburi')
    })
})

describe('familyDiffersFromFallback', () => {
    /** Fake canvas: a family reports the base width unless it is in `installed` and the chain is serif. */
    const measureWith = (installed: Record<string, number>) => (font: string) => {
        const chain = (font.split(',').pop() ?? font).replace('12px', '').trim()
        const family = font.match(/"([^"]+)"/)?.[1]
        const base = chain.length * 7
        return family && installed[family] !== undefined && chain === 'serif' ? base + installed[family] : base
    }

    it('reports a missing family as identical to every fallback', () => {
        const measure = measureWith({})
        expect(familyDiffersFromFallback('No Such Font', 'monospace', measure)).toBe(false)
        expect(familyDiffersFromFallback('No Such Font', 'serif', measure)).toBe(false)
    })

    it('detects a family that only differs from the serif fallback (the Consolas vs default-monospace case)', () => {
        const measure = measureWith({ Consolas: 0.5 })
        expect(familyDiffersFromFallback('Consolas', 'monospace', measure)).toBe(false)
        expect(familyDiffersFromFallback('Consolas', 'serif', measure)).toBe(true)
    })
})

describe('primaryFontFamily', () => {
    it('returns the first family unquoted', () => {
        expect(primaryFontFamily(`'JetBrains Mono NF', 'Leelawadee UI', monospace`)).toBe('JetBrains Mono NF')
        expect(primaryFontFamily('Consolas')).toBe('Consolas')
        expect(primaryFontFamily('')).toBe('')
    })
})

describe('buildTerminalFontFamily', () => {
    it('falls back to the default on blank input', () => {
        expect(buildTerminalFontFamily('', DEFAULT)).toBe(DEFAULT)
        expect(buildTerminalFontFamily('   ', DEFAULT)).toBe(DEFAULT)
    })

    it('wraps a bare name with the Thai fallback', () => {
        expect(buildTerminalFontFamily('Maple Mono NF', DEFAULT)).toBe(`'Maple Mono NF', ${TERMINAL_THAI_FALLBACK}`)
    })

    it('uses a full stack verbatim', () => {
        const stack = `'My Font', monospace`
        expect(buildTerminalFontFamily(stack, DEFAULT)).toBe(stack)
    })
})

describe('resolveTerminalFontFamily', () => {
    it('returns the pick when document.fonts is unavailable (fail-open)', () => {
        // vitest runs in node: no `document`, so the probe must not block the pick.
        expect(isFontInstalled('Anything At All')).toBe(true)
        expect(resolveTerminalFontFamily('Maple Mono NF', DEFAULT)).toBe(`'Maple Mono NF', ${TERMINAL_THAI_FALLBACK}`)
    })
})

describe('terminalFontPx', () => {
    it('keeps the configured size when the UI font is at its default', () => {
        expect(terminalFontPx(14, 1)).toBe(14)
    })

    it('divides out the UI font scale so the painted size stays absolute', () => {
        expect(terminalFontPx(14, 12 / 14)).toBeCloseTo(14 / (12 / 14))
        expect(terminalFontPx(14, 16 / 14)).toBeCloseTo(14 / (16 / 14))
    })

    it('fails open on a non-positive scale', () => {
        expect(terminalFontPx(14, 0)).toBe(14)
        expect(terminalFontPx(14, -1)).toBe(14)
    })
})
