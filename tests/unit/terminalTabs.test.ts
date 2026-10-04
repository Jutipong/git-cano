import { describe, expect, it } from 'vitest'

import {
    MAX_TERMINALS_PER_REPO,
    canAddTerminal,
    moveTerminalTab,
    terminalTabLabel,
    type TerminalTab,
} from '../../src/renderer/src/utils/terminalTabs'

function tab(id: string, shellLabel: string, name: string | null = null): TerminalTab {
    return { id, shell: shellLabel === 'cmd' ? 'cmd' : 'powershell', shellLabel, name }
}

describe('terminalTabLabel', () => {
    const tabs = [tab('t1', 'cmd'), tab('t2', 'powershell'), tab('t3', 'cmd')]

    it('numbers tabs by their position in the repo', () => {
        expect(tabs.map((t, i) => terminalTabLabel(t, i))).toEqual(['cmd 1', 'powershell 2', 'cmd 3'])
    })

    it('prefers a custom rename', () => {
        expect(terminalTabLabel(tab('t1', 'cmd', '  build  '), 0)).toBe('build')
    })

    it('falls back to the shell label when the rename is blank', () => {
        expect(terminalTabLabel(tab('t1', 'cmd', '   '), 0)).toBe('cmd 1')
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
