import { describe, expect, it } from 'vitest'

import { filterPaletteItems, matchesPaletteQuery, withOffsets } from '../../src/renderer/src/utils/palette'

describe('matchesPaletteQuery', () => {
    it('matches labels case-insensitively', () => {
        expect(matchesPaletteQuery({ label: 'Pull' }, 'pull')).toBe(true)
        expect(matchesPaletteQuery({ label: 'Push' }, 'PULL')).toBe(false)
    })

    it('matches the extra search text', () => {
        expect(matchesPaletteQuery({ label: 'git-cano', search: 'D:\\code\\git-cano' }, 'code')).toBe(true)
        expect(matchesPaletteQuery({ label: 'git-cano', search: 'D:\\code\\git-cano Main' }, 'main')).toBe(true)
    })

    it('treats an empty query as a match', () => {
        expect(matchesPaletteQuery({ label: 'Anything' }, '   ')).toBe(true)
    })
})

describe('filterPaletteItems', () => {
    const items = [{ label: 'Pull' }, { label: 'Push' }, { label: 'git-cano', search: 'D:\\code\\git-cano' }]

    it('returns everything on an empty query', () => {
        expect(filterPaletteItems(items, '')).toEqual(items)
    })

    it('preserves order while filtering', () => {
        expect(filterPaletteItems(items, 'p').map(i => i.label)).toEqual(['Pull', 'Push'])
        expect(filterPaletteItems(items, 'cano').map(i => i.label)).toEqual(['git-cano'])
    })
})

describe('withOffsets', () => {
    it('assigns cumulative flat-list offsets in order', () => {
        const sections = withOffsets([
            { title: 'Commands', items: [{ label: 'Pull' }, { label: 'Push' }] },
            { title: 'Repositories', items: [{ label: 'git-cano' }] },
            { title: 'AI', items: [] },
        ])
        expect(sections.map(s => [s.title, s.offset])).toEqual([
            ['Commands', 0],
            ['Repositories', 2],
            ['AI', 3],
        ])
    })
})
