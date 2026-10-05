import { describe, expect, it } from 'vitest'

import { isLoadableMarkdownImageSrc, resolveMarkdownImagePath } from '../../src/shared/markdownImages'

describe('isLoadableMarkdownImageSrc', () => {
    it('leaves remote and inline sources to the browser', () => {
        expect(isLoadableMarkdownImageSrc('https://img.shields.io/badge/x')).toBe(true)
        expect(isLoadableMarkdownImageSrc('http://example.com/a.png')).toBe(true)
        expect(isLoadableMarkdownImageSrc('//example.com/a.png')).toBe(true)
        expect(isLoadableMarkdownImageSrc('data:image/png;base64,AAA')).toBe(true)
    })

    it('marks repo-relative sources for IPC rewrite', () => {
        expect(isLoadableMarkdownImageSrc('docs/a.png')).toBe(false)
        expect(isLoadableMarkdownImageSrc('./a.png')).toBe(false)
        expect(isLoadableMarkdownImageSrc('/docs/a.png')).toBe(false)
        expect(isLoadableMarkdownImageSrc('')).toBe(false)
    })
})

describe('resolveMarkdownImagePath', () => {
    it('resolves relative to the markdown file directory', () => {
        expect(resolveMarkdownImagePath('README.md', 'docs/screenshots/01-overview.png')).toBe('docs/screenshots/01-overview.png')
        expect(resolveMarkdownImagePath('docs/guide.md', './assets/a.png')).toBe('docs/assets/a.png')
        expect(resolveMarkdownImagePath('docs/guide.md', '../shared/b.png')).toBe('shared/b.png')
        expect(resolveMarkdownImagePath('docs/sub/guide.md', '../../root.png')).toBe('root.png')
    })

    it('treats a leading slash as repo-rooted and strips query/fragment', () => {
        expect(resolveMarkdownImagePath('docs/guide.md', '/docs/a.png')).toBe('docs/a.png')
        expect(resolveMarkdownImagePath('README.md', 'docs/a.png?v=2#frag')).toBe('docs/a.png')
        expect(resolveMarkdownImagePath('README.md', 'docs/my%20pic.png')).toBe('docs/my pic.png')
    })

    it('rejects remote, inline and escaping sources', () => {
        expect(resolveMarkdownImagePath('README.md', 'https://example.com/a.png')).toBeNull()
        expect(resolveMarkdownImagePath('README.md', '//example.com/a.png')).toBeNull()
        expect(resolveMarkdownImagePath('README.md', 'data:image/png;base64,AAA')).toBeNull()
        expect(resolveMarkdownImagePath('README.md', '#frag')).toBeNull()
        expect(resolveMarkdownImagePath('docs/guide.md', '../../escape.png')).toBeNull()
        expect(resolveMarkdownImagePath('README.md', '../escape.png')).toBeNull()
        expect(resolveMarkdownImagePath('README.md', 'C:\\win.png')).toBeNull()
    })
})
