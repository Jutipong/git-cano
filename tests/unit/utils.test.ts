import { describe, expect, it } from 'vitest'

import { isPreviewablePath } from '../../src/renderer/src/utils/preview'
import { stripMarkdown } from '../../src/renderer/src/utils/changelog'
import { isFreeZenId, toGoModel } from '../../src/shared/models'

describe('isPreviewablePath', () => {
    it('accepts markdown and json variants', () => {
        expect(isPreviewablePath('README.md')).toBe(true)
        expect(isPreviewablePath('docs/guide.MARKDOWN')).toBe(true)
        expect(isPreviewablePath('a.mdown')).toBe(true)
        expect(isPreviewablePath('data.json')).toBe(true)
    })

    it('rejects other files', () => {
        expect(isPreviewablePath('app.ts')).toBe(false)
        expect(isPreviewablePath('notes.txt')).toBe(false)
    })
})

describe('stripMarkdown', () => {
    it('strips headings, marks, links, code fences and bullets', () => {
        const body = ['## Fixes', '', '- **bold** item', '- [link](https://example.com)', '', '```js', 'const x = 1', '```'].join('\n')
        const text = stripMarkdown(body)
        expect(text).not.toContain('#')
        expect(text).not.toContain('**')
        expect(text).not.toContain('https://example.com')
        expect(text).not.toContain('const x = 1')
        expect(text).toContain('Fixes')
        expect(text).toContain('• bold item')
        expect(text).toContain('• link')
    })
})

describe('models', () => {
    it('detects free Zen ids', () => {
        expect(isFreeZenId('grok-code-fast-free')).toBe(true)
        expect(isFreeZenId('big-pickle')).toBe(true)
        expect(isFreeZenId('claude-sonnet-4')).toBe(false)
    })

    it('marks free models in the GoModel wrapper', () => {
        expect(toGoModel('x-free')).toEqual({ id: 'x-free', name: 'x-free', free: true })
        expect(toGoModel('x')).toEqual({ id: 'x', name: 'x' })
    })
})
