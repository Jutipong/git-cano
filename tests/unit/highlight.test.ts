import { describe, expect, it } from 'vitest'

import {
    computeLineStates,
    detectMovedLines,
    highlightLine,
    isWhitespaceOnlyChange,
    markChangedLines,
    markHighlightedRanges,
} from '../../src/renderer/src/utils/highlight'

import type { DiffLine } from '../../src/shared/types'

function line(type: DiffLine['type'], text: string): DiffLine {
    return { type, oldNo: null, newNo: null, text }
}

describe('isWhitespaceOnlyChange', () => {
    it('detects whitespace-only edits', () => {
        expect(isWhitespaceOnlyChange(' a b', '  a  b ')).toBe(true)
        expect(isWhitespaceOnlyChange(' a b', ' a c')).toBe(false)
    })
})

describe('detectMovedLines', () => {
    it('marks a del/add pair with identical text in different blocks', () => {
        const del = line('del', '-moved line')
        const add = line('add', '+moved line')
        const moved = detectMovedLines([del, line('ctx', ' x'), add])
        expect(moved.has(del)).toBe(true)
        expect(moved.has(add)).toBe(true)
    })

    it('does not mark unrelated lines', () => {
        const del = line('del', '-alpha')
        const add = line('add', '+beta')
        expect(detectMovedLines([del, add]).size).toBe(0)
    })
})

describe('markChangedLines', () => {
    it('marks the changed token run of similar lines', () => {
        const del = line('del', '-const value = 1')
        const add = line('add', '+const value = 2')
        const marks = markChangedLines([del], [add])
        expect(marks.get(del)?.length).toBeGreaterThan(0)
        expect(marks.get(add)?.length).toBeGreaterThan(0)
    })

    it('skips unrelated lines below the similarity threshold', () => {
        const del = line('del', '-Memo = dto.memo')
        const add = line('add', '+PayDate = dto.paydate,')
        expect(markChangedLines([del], [add]).size).toBe(0)
    })
})

describe('markHighlightedRanges', () => {
    it('wraps ranges in already-highlighted HTML without splitting tokens', () => {
        const html = '<span class="tok-keyword">const</span> value = 1'
        const source = 'const value = 1'
        const output = markHighlightedRanges(html, source, [{ start: 6, end: 11, className: 'search-hit' }])
        expect(output).toContain('<mark class="search-hit">')
        expect(output).toContain('value')
        expect(output).toContain('</mark>')
    })
})

describe('computeLineStates', () => {
    it('carries block-comment state across lines', () => {
        const lines = [line('ctx', ' /* start'), line('ctx', ' middle'), line('ctx', ' end */'), line('ctx', ' const x = 1')]
        const store = computeLineStates(lines, 'a.js')
        expect(store.context(0).state.blockComment).toBe(false)
        expect(store.context(1).state.blockComment).toBe(true)
        expect(store.context(2).state.blockComment).toBe(true)
        expect(store.context(3).state.blockComment).toBe(false)
    })

    it('tracks vue SFC sections', () => {
        const lines = [
            line('ctx', ' <template>'),
            line('ctx', ' <div>hello</div>'),
            line('ctx', ' </template>'),
            line('ctx', ' <script setup>'),
            line('ctx', ' const x = 1'),
        ]
        const store = computeLineStates(lines, 'a.vue')
        expect(store.context(0).section).toBe('template')
        expect(store.context(1).section).toBe('template')
        expect(store.context(2).section).toBe('template')
        expect(store.context(3).section).toBe('template')
        expect(store.context(4).section).toBe('script')
    })
})

describe('highlightLine', () => {
    it('wraps keywords in token spans', () => {
        expect(highlightLine('const x = 1', 'a.ts')).toContain('tok-keyword')
        expect(highlightLine('def foo():', 'a.py')).toContain('tok-keyword')
    })
})
