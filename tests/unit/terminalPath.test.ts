import { describe, expect, it } from 'vitest'

import { mergePathValue, normalizePathEntry, pathKeyFor } from '../../src/shared/terminalPath'

describe('pathKeyFor', () => {
    it('finds PATH case-insensitively and preserves casing', () => {
        expect(pathKeyFor(['Path', 'HOME'], 'PATH')).toBe('Path')
        expect(pathKeyFor(['PATH', 'HOME'], 'Path')).toBe('PATH')
        expect(pathKeyFor(['path'], 'PATH')).toBe('path')
    })

    it('falls back when no PATH key exists', () => {
        expect(pathKeyFor(['HOME'], 'Path')).toBe('Path')
        expect(pathKeyFor([], 'PATH')).toBe('PATH')
    })
})

describe('normalizePathEntry', () => {
    it('trims separators and folds case when insensitive', () => {
        expect(normalizePathEntry('C:\\Users\\A\\npm\\\\', true)).toBe('c:\\users\\a\\npm')
        expect(normalizePathEntry('/opt/homebrew/bin/', false)).toBe('/opt/homebrew/bin')
    })
})

describe('mergePathValue', () => {
    it('prepends missing candidates in order', () => {
        expect(mergePathValue('C:\\Windows', ['C:\\Tools', 'D:\\Bin'], ';', true)).toBe('C:\\Tools;D:\\Bin;C:\\Windows')
    })

    it('skips duplicates case-insensitively and keeps the original entry', () => {
        expect(mergePathValue('c:\\tools;C:\\Windows', ['C:\\Tools', 'D:\\Bin'], ';', true)).toBe(
            'D:\\Bin;c:\\tools;C:\\Windows'
        )
    })

    it('drops empties and handles an empty base', () => {
        expect(mergePathValue('', ['', 'D:\\Bin'], ';', true)).toBe('D:\\Bin')
        expect(mergePathValue('a:b', [], ':', false)).toBe('a:b')
    })
})
