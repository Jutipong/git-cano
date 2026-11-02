import { describe, expect, it } from 'vitest'

import { isConflicted } from '../../src/renderer/src/utils/status'

describe('isConflicted', () => {
    it('covers every unmerged porcelain code', () => {
        for (const code of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
            expect(isConflicted({ staged: code[0], unstaged: code[1] }), code).toBe(true)
        }
    })

    it('leaves ordinary staged, unstaged and untracked files alone', () => {
        expect(isConflicted({ staged: ' ', unstaged: 'M' })).toBe(false)
        expect(isConflicted({ staged: 'M', unstaged: ' ' })).toBe(false)
        expect(isConflicted({ staged: 'A', unstaged: ' ' })).toBe(false)
        expect(isConflicted({ staged: 'A', unstaged: '?' })).toBe(false)
        expect(isConflicted({ staged: 'M', unstaged: 'M' })).toBe(false)
        expect(isConflicted({ staged: ' ', unstaged: ' ' })).toBe(false)
    })
})
