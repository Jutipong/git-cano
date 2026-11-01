import { describe, expect, it } from 'vitest'

import { fullBlockCells, verticalRuleRun } from '../../src/renderer/src/utils/terminalBars'

describe('fullBlockCells', () => {
    it('counts the filled cells of a meter run', () => {
        expect(fullBlockCells('████░░░')).toBe(4)
        expect(fullBlockCells('████████████████████░░░░░░░░░░░')).toBe(20)
        expect(fullBlockCells('██')).toBe(2)
        expect(fullBlockCells('█')).toBe(1)
    })

    it('rejects spans that are not a fill plus optional track', () => {
        expect(fullBlockCells('')).toBe(0)
        expect(fullBlockCells('░░░')).toBe(0)
        expect(fullBlockCells('Total ███')).toBe(0)
        expect(fullBlockCells('██x░░')).toBe(0)
        expect(fullBlockCells('██ ░░')).toBe(0)
        expect(fullBlockCells('สวัสดี')).toBe(0)
    })
})

describe('verticalRuleRun', () => {
    it('classifies the solid vertical rules by stroke weight', () => {
        expect(verticalRuleRun('│')).toEqual({ kind: 'light', part: 'full', cells: 1 })
        expect(verticalRuleRun('││││')).toEqual({ kind: 'light', part: 'full', cells: 4 })
        expect(verticalRuleRun('┃')).toEqual({ kind: 'heavy', part: 'full', cells: 1 })
        expect(verticalRuleRun('┃┃┃┃┃')).toEqual({ kind: 'heavy', part: 'full', cells: 5 })
    })

    it('recognises the half-cell caps a rail ends on', () => {
        expect(verticalRuleRun('╵')).toEqual({ kind: 'light', part: 'top', cells: 1 })
        expect(verticalRuleRun('╹')).toEqual({ kind: 'heavy', part: 'top', cells: 1 })
        expect(verticalRuleRun('╷')).toEqual({ kind: 'light', part: 'bottom', cells: 1 })
        expect(verticalRuleRun('╻')).toEqual({ kind: 'heavy', part: 'bottom', cells: 1 })
    })

    it('keeps a gutter padded with same-colour blanks on the rule cells only', () => {
        expect(verticalRuleRun('┃   ')).toEqual({ kind: 'heavy', part: 'full', cells: 1 })
        expect(verticalRuleRun('││    ')).toEqual({ kind: 'light', part: 'full', cells: 2 })
        expect(verticalRuleRun('╹  ')).toEqual({ kind: 'heavy', part: 'top', cells: 1 })
    })

    it('leaves dashed, double and mixed rules alone', () => {
        expect(verticalRuleRun('')).toBeNull()
        expect(verticalRuleRun('┆┆')).toBeNull()
        expect(verticalRuleRun('┇┇')).toBeNull()
        expect(verticalRuleRun('┊┋')).toBeNull()
        expect(verticalRuleRun('║')).toBeNull()
        expect(verticalRuleRun('│┃')).toBeNull()
        expect(verticalRuleRun('│ text')).toBeNull()
        expect(verticalRuleRun('  ┃')).toBeNull()
        expect(verticalRuleRun('╹╹')).toBeNull()
        expect(verticalRuleRun('╹ x')).toBeNull()
        expect(verticalRuleRun('▌')).toBeNull()
        expect(verticalRuleRun('█')).toBeNull()
        expect(verticalRuleRun('สวัสดี')).toBeNull()
    })
})
