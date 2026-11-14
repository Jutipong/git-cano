import { describe, expect, it } from 'vitest'

import { thaiClusterJoins } from '../../src/renderer/src/utils/terminalThai'

describe('thaiClusterJoins', () => {
    it('joins SARA AM with the consonant before it', () => {
        expect(thaiClusterJoins('จำนำ')).toEqual([
            [0, 2],
            [2, 4],
        ])
        expect(thaiClusterJoins('กำ')).toEqual([[0, 2]])
        expect(thaiClusterJoins('ทำไม')).toEqual([[0, 2]])
    })

    it('walks back over the tone marks that sit inside the consonant cell', () => {
        // น + ้ + ำ: the mark belongs to น's cell, so the range has to start at น.
        expect(thaiClusterJoins('น้ำ')).toEqual([[0, 3]])
        expect(thaiClusterJoins('AAA น้ำ ZZZ')).toEqual([[4, 7]])
    })

    it('keeps other Thai clusters untouched', () => {
        expect(thaiClusterJoins('ที่นี่ หน่อย')).toEqual([])
    })

    it('ignores a SARA AM with no Thai consonant in front of it', () => {
        expect(thaiClusterJoins('ำ')).toEqual([])
        expect(thaiClusterJoins(' hello ำ')).toEqual([])
        expect(thaiClusterJoins('123ำ')).toEqual([])
    })

    it('ignores text without SARA AM', () => {
        expect(thaiClusterJoins('')).toEqual([])
        expect(thaiClusterJoins('MMM-mmm_0123')).toEqual([])
        expect(thaiClusterJoins('สวัสดีครับ')).toEqual([])
    })
})
