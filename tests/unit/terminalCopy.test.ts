import { describe, expect, it } from 'vitest'

import { terminalCopyDecision } from '../../src/renderer/src/utils/terminalCopy'

type KeyEvent = Parameters<typeof terminalCopyDecision>[0]

function key(overrides: Partial<KeyEvent> & Pick<KeyEvent, 'key'>): KeyEvent {
    return { type: 'keydown', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides }
}

describe('terminalCopyDecision (Windows/Linux)', () => {
    it('copies a plain Ctrl+C only when text is selected', () => {
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true }), true, false)).toBe('copy')
        expect(terminalCopyDecision(key({ key: 'C', ctrlKey: true }), true, false)).toBe('copy')
        // No selection: keep ETX for the shell, so a running command can still be interrupted.
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true }), false, false)).toBe('pass')
    })

    it('always handles Ctrl+Shift+C, copying only with a selection', () => {
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, shiftKey: true }), true, false)).toBe('copy')
        expect(terminalCopyDecision(key({ key: 'C', ctrlKey: true, shiftKey: true }), false, false)).toBe('consume')
    })

    it('ignores keypress events so a copy press is never handled twice', () => {
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, type: 'keypress' }), true, false)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, shiftKey: true, type: 'keypress' }), true, false)).toBe('pass')
    })

    it('passes everything else through to the shell', () => {
        expect(terminalCopyDecision(key({ key: 'c' }), true, false)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'v', ctrlKey: true }), true, false)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, altKey: true }), true, false)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, altKey: true, shiftKey: true }), true, false)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, metaKey: true }), true, false)).toBe('pass')
    })
})

describe('terminalCopyDecision (macOS)', () => {
    it('copies with Cmd+C and keeps Ctrl+C as the shell interrupt', () => {
        expect(terminalCopyDecision(key({ key: 'c', metaKey: true }), true, true)).toBe('copy')
        expect(terminalCopyDecision(key({ key: 'c', metaKey: true }), false, true)).toBe('consume')
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true }), true, true)).toBe('pass')
    })

    it('also accepts Ctrl+Shift+C and leaves Cmd+Shift+C alone', () => {
        expect(terminalCopyDecision(key({ key: 'c', ctrlKey: true, shiftKey: true }), true, true)).toBe('copy')
        expect(terminalCopyDecision(key({ key: 'c', metaKey: true, shiftKey: true }), true, true)).toBe('pass')
        expect(terminalCopyDecision(key({ key: 'c', metaKey: true, altKey: true }), true, true)).toBe('pass')
    })
})
