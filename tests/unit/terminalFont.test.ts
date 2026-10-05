import { describe, expect, it } from 'vitest'

import {
    buildTerminalFontFamily,
    isFontInstalled,
    primaryFontFamily,
    resolveTerminalFontFamily,
    TERMINAL_THAI_FALLBACK,
} from '../../src/renderer/src/utils/terminalFont'

const DEFAULT = `'Consolas', ${TERMINAL_THAI_FALLBACK}`

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
