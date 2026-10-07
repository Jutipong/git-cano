import { describe, expect, it } from 'vitest'

import {
    CUSTOM_SHORTCUT_IDS,
    SHORTCUT_DEFAULTS,
    eventToCombo,
    formatCombo,
    formatComboMac,
    isReservedCombo,
    isValidSyncCombo,
} from '../../src/renderer/src/utils/shortcuts'

function keyEvent(key: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}): KeyboardEvent {
    return {
        key,
        ctrlKey: !!modifiers.ctrl,
        shiftKey: !!modifiers.shift,
        altKey: !!modifiers.alt,
        metaKey: !!modifiers.meta,
    } as KeyboardEvent
}

describe('eventToCombo', () => {
    it('normalizes modifier keys to canonical combos', () => {
        expect(eventToCombo(keyEvent('ArrowUp', { ctrl: true }))).toBe('Ctrl+ArrowUp')
        expect(eventToCombo(keyEvent('ArrowDown', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+ArrowDown')
        expect(eventToCombo(keyEvent('a', { ctrl: true }))).toBe('Ctrl+A')
        expect(eventToCombo(keyEvent(' ', { ctrl: true }))).toBe('Ctrl+Space')
    })

    it('treats Cmd as Ctrl and rejects modifier-only presses', () => {
        expect(eventToCombo(keyEvent('p', { meta: true }))).toBe('Ctrl+P')
        expect(eventToCombo(keyEvent('Control', { ctrl: true }))).toBeNull()
        expect(eventToCombo(keyEvent('Shift', { shift: true }))).toBeNull()
        expect(eventToCombo(keyEvent('a'))).toBeNull()
    })
})

describe('formatCombo / formatComboMac', () => {
    it('renders arrows and the macOS command glyph', () => {
        expect(formatCombo('Ctrl+Shift+ArrowDown')).toBe('Ctrl+Shift+↓')
        expect(formatComboMac('Ctrl+ArrowUp')).toBe('⌘+↑')
    })
})

describe('isValidSyncCombo', () => {
    it('requires Ctrl plus a main key', () => {
        expect(isValidSyncCombo('Ctrl+ArrowUp')).toBe(true)
        expect(isValidSyncCombo('Ctrl+K')).toBe(true)
        expect(isValidSyncCombo('ArrowUp')).toBe(false)
        expect(isValidSyncCombo('Ctrl')).toBe(false)
        expect(isValidSyncCombo('Ctrl+Shift')).toBe(false)
    })
})

describe('isReservedCombo', () => {
    it('rejects fixed combos and combos taken by other ids', () => {
        expect(isReservedCombo('Ctrl+W', {})).toBe(true)
        expect(isReservedCombo('Ctrl+K', { push: 'Ctrl+K' })).toBe(true)
        expect(isReservedCombo('Ctrl+K', { push: 'Ctrl+K' }, 'push')).toBe(false)
        expect(isReservedCombo('Ctrl+J', { push: 'Ctrl+K' })).toBe(false)
    })

    it('reserves the fixed terminal tab combos', () => {
        expect(isReservedCombo('Ctrl+T', {})).toBe(true)
        for (let index = 1; index <= 9; index++) {
            expect(isReservedCombo(`Ctrl+${index}`, {})).toBe(true)
        }
    })
})

describe('shortcut catalog', () => {
    it('has a default for every customizable id', () => {
        for (const id of CUSTOM_SHORTCUT_IDS) {
            expect(SHORTCUT_DEFAULTS[id]).toBeTruthy()
        }
    })
})
