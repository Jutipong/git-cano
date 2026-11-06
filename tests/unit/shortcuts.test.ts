import { describe, expect, it } from 'vitest'

import {
    CUSTOM_SHORTCUT_IDS,
    SHORTCUTS,
    SHORTCUT_DEFAULTS,
    SHORTCUT_GROUPS,
    eventToCombo,
    eventToCombos,
    formatCombo,
    formatComboMac,
    isReservedCombo,
    isValidSyncCombo,
    mainKeysOf,
} from '../../src/renderer/src/utils/shortcuts'

function keyEvent(
    key: string,
    modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; code?: string } = {}
): KeyboardEvent {
    return {
        key,
        code: modifiers.code ?? '',
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

describe('mainKeysOf', () => {
    it('offers the typed character first and the physical key second', () => {
        // Thai Kedmanee reports "_" on the key beside "1"; its physical code is Backquote.
        expect(mainKeysOf(keyEvent('_', { code: 'Backquote' }))).toEqual(['_', '`'])
        expect(eventToCombos(keyEvent('_', { code: 'Backquote', ctrl: true }))).toEqual(['Ctrl+_', 'Ctrl+`'])
    })

    it('keeps the typed letter first on remapped Latin layouts', () => {
        expect(mainKeysOf(keyEvent('a', { code: 'KeyQ' }))).toEqual(['A', 'Q'])
        expect(eventToCombos(keyEvent('a', { code: 'KeyQ', ctrl: true }))).toEqual(['Ctrl+A', 'Ctrl+Q'])
    })

    it('collapses duplicates and ignores modifier-only keys', () => {
        expect(mainKeysOf(keyEvent('o', { code: 'KeyO' }))).toEqual(['O'])
        expect(mainKeysOf(keyEvent('Control', { code: 'ControlLeft' }))).toEqual([])
        expect(eventToCombos(keyEvent('Tab', { code: 'Tab' }))).toEqual([])
    })
})

describe('eventToCombo on non-Latin layouts', () => {
    it('falls back to the physical key when the layout produces a local character', () => {
        // Thai Kedmanee types Thai letters; event.code keeps the QWERTY position.
        expect(eventToCombo(keyEvent('พ', { ctrl: true, code: 'KeyP' }))).toBe('Ctrl+P')
        expect(eventToCombo(keyEvent('ก', { ctrl: true, code: 'KeyK' }))).toBe('Ctrl+K')
        expect(eventToCombo(keyEvent('๐', { ctrl: true, code: 'Digit0' }))).toBe('Ctrl+0')
        expect(eventToCombo(keyEvent('ๅ', { ctrl: true, code: 'Backquote' }))).toBe('Ctrl+`')
    })

    it('keeps the typed character on Latin layouts (AZERTY/Dvorak)', () => {
        expect(eventToCombo(keyEvent('a', { ctrl: true, code: 'KeyQ' }))).toBe('Ctrl+A')
    })

    it('keeps named keys and Space unchanged', () => {
        expect(eventToCombo(keyEvent('ArrowDown', { ctrl: true, code: 'ArrowDown' }))).toBe('Ctrl+ArrowDown')
        expect(eventToCombo(keyEvent(' ', { ctrl: true, code: 'Space' }))).toBe('Ctrl+Space')
        expect(mainKeysOf(keyEvent('Tab', { code: 'Tab' }))).toEqual(['Tab'])
    })

    it('returns null when a non-ASCII key has no usable physical code', () => {
        expect(eventToCombo(keyEvent('พ', { ctrl: true }))).toBeNull()
        expect(mainKeysOf(keyEvent('Unidentified', { ctrl: true }))).toEqual([])
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
        expect(isReservedCombo('Ctrl+B', {})).toBe(true)
        expect(isReservedCombo('Ctrl+K', { push: 'Ctrl+K' })).toBe(true)
        expect(isReservedCombo('Ctrl+K', { push: 'Ctrl+K' }, 'push')).toBe(false)
        expect(isReservedCombo('Ctrl+J', { push: 'Ctrl+K' })).toBe(false)
    })

    it('reserves the fixed terminal tab combos', () => {
        expect(isReservedCombo('Ctrl+T', {})).toBe(true)
        expect(isReservedCombo('Ctrl+Tab', {})).toBe(true)
        expect(isReservedCombo('Alt+ArrowLeft', {})).toBe(true)
        expect(isReservedCombo('Alt+ArrowRight', {})).toBe(true)
    })
})

describe('shortcut catalog', () => {
    it('has a default for every customizable id', () => {
        for (const id of CUSTOM_SHORTCUT_IDS) {
            expect(SHORTCUT_DEFAULTS[id]).toBeTruthy()
        }
    })

    it('assigns every shortcut to a known group', () => {
        const groupIds = new Set(SHORTCUT_GROUPS.map(group => group.id))
        expect(SHORTCUTS.length).toBeGreaterThan(0)
        for (const shortcut of SHORTCUTS) {
            expect(groupIds.has(shortcut.group)).toBe(true)
        }
        for (const group of SHORTCUT_GROUPS) {
            expect(SHORTCUTS.some(shortcut => shortcut.group === group.id)).toBe(true)
        }
    })
})
