import { describe, expect, it } from 'vitest'

import {
    MAX_TERMINALS_PER_REPO,
    canAddTerminal,
    moveTerminalTab,
    nextTerminalNumber,
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
    it('stops at the per-repo cap', () => {
        expect(canAddTerminal(0)).toBe(true)
        expect(canAddTerminal(MAX_TERMINALS_PER_REPO - 1)).toBe(true)
        expect(canAddTerminal(MAX_TERMINALS_PER_REPO)).toBe(false)
        expect(canAddTerminal(MAX_TERMINALS_PER_REPO + 2)).toBe(false)
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
