import { describe, expect, it } from 'vitest'

import { fullBlockCells } from '../../src/renderer/src/utils/terminalBars'

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
