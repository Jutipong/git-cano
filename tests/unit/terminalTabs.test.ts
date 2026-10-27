import { describe, expect, it } from 'vitest'

import {
    canAddTerminal,
    moveTerminalTab,
    nextTerminalNumber,
    nextTerminalTabId,
    prevTerminalTabId,
    terminalTabLabel,
    type TerminalTab,
} from '../../src/renderer/src/utils/terminalTabs'

function tab(id: string, shell: TerminalTab['shell'], number: number, name: string | null = null): TerminalTab {
    const shellLabel = shell === 'cmd' ? 'cmd' : shell === 'pwsh' ? 'pwsh' : 'powershell'
    return { id, shell, shellLabel, number, name }
}

describe('terminalTabLabel', () => {
    it("uses the tab's own number, not its slot", () => {
        // The order here is a reordered list: every tab keeps the number it was born with.
        const tabs = [tab('t1', 'cmd', 2), tab('t2', 'powershell', 1), tab('t3', 'cmd', 1)]
        expect(tabs.map(tab => terminalTabLabel(tab))).toEqual(['cmd 2', 'powershell 1', 'cmd 1'])
    })

    it('prefers a custom rename', () => {
        expect(terminalTabLabel(tab('t1', 'cmd', 3, '  build  '))).toBe('build')
    })

    it('falls back to the shell label when the rename is blank', () => {
        expect(terminalTabLabel(tab('t1', 'cmd', 2, '   '))).toBe('cmd 2')
    })
})

describe('nextTerminalNumber', () => {
    it('numbers per shell, one past the highest live sibling', () => {
        const tabs = [tab('t1', 'cmd', 1), tab('t2', 'pwsh', 1), tab('t3', 'cmd', 3), tab('t4', 'powershell', 2)]
        expect(nextTerminalNumber(tabs, 'cmd')).toBe(4)
        expect(nextTerminalNumber(tabs, 'pwsh')).toBe(2)
        expect(nextTerminalNumber(tabs, 'powershell')).toBe(3)
        expect(nextTerminalNumber([], 'cmd')).toBe(1)
    })
})

describe('canAddTerminal', () => {
    it('stops at the given per-repo cap', () => {
        expect(canAddTerminal(0, 4)).toBe(true)
        expect(canAddTerminal(3, 4)).toBe(true)
        expect(canAddTerminal(4, 4)).toBe(false)
        expect(canAddTerminal(6, 4)).toBe(false)
        expect(canAddTerminal(5, 6)).toBe(true)
        expect(canAddTerminal(6, 6)).toBe(false)
    })
})

describe('nextTerminalTabId', () => {
    const tabs = [{ id: 't1' }, { id: 't2' }, { id: 't3' }]

    it('advances to the next tab and wraps from the last back to the first', () => {
        expect(nextTerminalTabId(tabs, 't1')).toBe('t2')
        expect(nextTerminalTabId(tabs, 't2')).toBe('t3')
        expect(nextTerminalTabId(tabs, 't3')).toBe('t1')
    })

    it('is a no-op with fewer than two tabs, an unknown id or no active tab', () => {
        expect(nextTerminalTabId([], null)).toBeNull()
        expect(nextTerminalTabId([{ id: 't1' }], 't1')).toBeNull()
        expect(nextTerminalTabId(tabs, 'gone')).toBeNull()
        expect(nextTerminalTabId(tabs, null)).toBeNull()
    })
})

describe('prevTerminalTabId', () => {
    const tabs = [{ id: 't1' }, { id: 't2' }, { id: 't3' }]

    it('steps back and wraps from the first to the last', () => {
        expect(prevTerminalTabId(tabs, 't3')).toBe('t2')
        expect(prevTerminalTabId(tabs, 't2')).toBe('t1')
        expect(prevTerminalTabId(tabs, 't1')).toBe('t3')
    })

    it('is a no-op with fewer than two tabs, an unknown id or no active tab', () => {
        expect(prevTerminalTabId([], null)).toBeNull()
        expect(prevTerminalTabId([{ id: 't1' }], 't1')).toBeNull()
        expect(prevTerminalTabId(tabs, 'gone')).toBeNull()
        expect(prevTerminalTabId(tabs, null)).toBeNull()
    })
})

describe('moveTerminalTab', () => {
    const tabs = ['t1', 't2', 't3', 't4']

    it('moves a tab to the target index', () => {
        expect(moveTerminalTab(tabs, 0, 2)).toEqual(['t2', 't3', 't1', 't4'])
        expect(moveTerminalTab(tabs, 3, 0)).toEqual(['t4', 't1', 't2', 't3'])
    })

    it('ignores no-op and out-of-range drags', () => {
        expect(moveTerminalTab(tabs, 1, 1)).toBe(tabs)
        expect(moveTerminalTab(tabs, -1, 2)).toBe(tabs)
        expect(moveTerminalTab(tabs, 0, 9)).toBe(tabs)
    })

    it('never mutates the original list', () => {
        const next = moveTerminalTab(tabs, 0, 3)
        expect(tabs).toEqual(['t1', 't2', 't3', 't4'])
        expect(next).not.toBe(tabs)
    })
})
