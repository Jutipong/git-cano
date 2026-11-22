import { describe, expect, it } from 'vitest'

import {
    AI_CONTEXT_SECTION_MAX,
    MAX_DIFF_LINES,
    capContextSection,
    capDiffLines,
    escapeGitignorePath,
    normalizeRef,
    parseDiff,
    parseLog,
    parseMergeTreeOutput,
    parseNameStatus,
    parseNumstatMap,
} from '../../src/main/parsers'

import type { DiffLine } from '../../src/shared/types'

const SEP = '\x1f'
const REC = '\x1e'

function logRecord(fields: {
    hash: string
    parents: string
    shortHash: string
    author: string
    email: string
    date: string
    refs: string
    subject: string
    bodyMark: string
}): string {
    return [
        fields.hash,
        fields.parents,
        fields.shortHash,
        fields.author,
        fields.email,
        fields.date,
        fields.refs,
        fields.subject,
        fields.bodyMark,
    ].join(SEP)
}

function ctx(text: string): DiffLine {
    return { type: 'ctx', oldNo: 1, newNo: 1, text: ` ${text}` }
}

describe('normalizeRef', () => {
    it('normalizes heads, HEAD, tags and remotes', () => {
        expect(normalizeRef('HEAD -> refs/heads/main')).toBe('HEAD -> main')
        expect(normalizeRef('refs/heads/feature')).toBe('feature')
        expect(normalizeRef('tag: refs/tags/v1.0^{}')).toBe('tag: v1.0')
        expect(normalizeRef('refs/tags/v2')).toBe('tag: v2')
        expect(normalizeRef('refs/remotes/origin/main')).toBe('remote:origin/main')
    })

    it('drops remote HEAD symrefs and blanks', () => {
        expect(normalizeRef('refs/remotes/origin/HEAD')).toBeNull()
        expect(normalizeRef('  ')).toBeNull()
    })
})

describe('parseLog', () => {
    it('parses fields, parents, refs and the hasBody marker', () => {
        const first = logRecord({
            hash: 'a'.repeat(40),
            parents: 'b'.repeat(40),
            shortHash: 'aaaaaaa',
            author: 'Alice',
            email: 'alice@example.com',
            date: '2026-01-01T00:00:00+00:00',
            refs: ' (HEAD -> main, tag: v1, refs/remotes/origin/main)',
            subject: 'feat: add notes',
            bodyMark: 'B',
        })
        const second = logRecord({
            hash: 'c'.repeat(40),
            parents: '',
            shortHash: 'ccccccc',
            author: 'Bob',
            email: '',
            date: '2026-01-02T00:00:00+00:00',
            refs: '',
            subject: 'chore: root',
            bodyMark: ' ',
        })
        const text = `${first}${REC}\n${second}${REC}`

        const commits = parseLog(text)
        expect(commits).toHaveLength(2)
        expect(commits[0]).toMatchObject({
            hash: 'a'.repeat(40),
            shortHash: 'aaaaaaa',
            author: 'Alice',
            authorEmail: 'alice@example.com',
            subject: 'feat: add notes',
            parents: ['b'.repeat(40)],
            refs: ['HEAD -> main', 'tag: v1', 'remote:origin/main'],
            hasBody: true,
            lane: 0,
        })
        // The truncation marker pads empty bodies with a space — that must NOT count as a body.
        expect(commits[1]!.hasBody).toBeUndefined()
        expect(commits[1]!.authorEmail).toBeUndefined()
        expect(commits[1]!.parents).toEqual([])
        expect(commits[1]!.refs).toEqual([])
    })
})

describe('parseDiff', () => {
    it('parses hunk headers and line numbers', () => {
        const text = [
            'diff --git a/f.txt b/f.txt',
            'index 1111111..2222222 100644',
            '--- a/f.txt',
            '+++ b/f.txt',
            '@@ -1,3 +1,3 @@',
            ' ctx one',
            '-old line',
            '+new line',
            ' ctx two',
            '\\ No newline at end of file',
        ].join('\n')

        const lines = parseDiff(text, 'f.txt')
        expect(lines[0]).toMatchObject({ type: 'meta', text: 'diff --git a/f.txt b/f.txt' })
        expect(lines[1]).toMatchObject({ type: 'hunk', text: '@@ -1,3 +1,3 @@' })
        expect(lines[2]).toMatchObject({ type: 'ctx', oldNo: 1, newNo: 1 })
        expect(lines[3]).toMatchObject({ type: 'del', oldNo: 2, newNo: null })
        expect(lines[4]).toMatchObject({ type: 'add', oldNo: null, newNo: 2 })
        expect(lines[5]).toMatchObject({ type: 'ctx', oldNo: 3, newNo: 3 })
        expect(lines[6]).toMatchObject({ type: 'meta', text: '\\ No newline at end of file' })
    })
})

describe('capDiffLines', () => {
    it('returns the same array when under the cap', () => {
        const lines = [ctx('a'), ctx('b')]
        expect(capDiffLines(lines)).toBe(lines)
    })

    it('truncates at the cap and appends a marker', () => {
        const lines = Array.from({ length: MAX_DIFF_LINES + 5 }, (_, i) => ctx(`line ${i}`))
        const capped = capDiffLines(lines)
        expect(capped).toHaveLength(MAX_DIFF_LINES + 1)
        expect(capped[MAX_DIFF_LINES]).toMatchObject({ type: 'meta' })
        expect(capped[MAX_DIFF_LINES]!.text).toContain('truncated')
        expect(capped[MAX_DIFF_LINES]!.text).toContain('5 more lines')
    })
})

describe('escapeGitignorePath', () => {
    it('leaves ordinary paths untouched', () => {
        expect(escapeGitignorePath('src/main/git.ts')).toBe('src/main/git.ts')
        expect(escapeGitignorePath('a b/c-d_e.txt')).toBe('a b/c-d_e.txt')
    })

    it('escapes gitignore glob metacharacters', () => {
        expect(escapeGitignorePath('build[1]/out.txt')).toBe('build\\[1\\]/out.txt')
        expect(escapeGitignorePath('test[1].txt')).toBe('test\\[1\\].txt')
        expect(escapeGitignorePath('a*b?c')).toBe('a\\*b\\?c')
        expect(escapeGitignorePath('back\\slash')).toBe('back\\\\slash')
    })
})

describe('capContextSection', () => {
    it('leaves short text untouched', () => {
        const text = 'small diff'
        expect(capContextSection(text)).toBe(text)
    })

    it('cuts on a line boundary and marks the truncation', () => {
        const line = 'x'.repeat(99)
        const text = Array.from({ length: 400 }, () => line).join('\n')
        const capped = capContextSection(text)
        expect(capped.length).toBeLessThanOrEqual(AI_CONTEXT_SECTION_MAX + 20)
        expect(capped.endsWith('… (truncated)')).toBe(true)
        expect(capped).not.toContain('xx…')
    })
})

describe('parseNumstatMap', () => {
    it('maps paths to additions/deletions and treats binary entries as zero', () => {
        const map = parseNumstatMap('12\t3\tsrc/a.ts\n-\t-\timg.png\n')
        expect(map.get('src/a.ts')).toEqual({ additions: 12, deletions: 3 })
        expect(map.get('img.png')).toEqual({ additions: 0, deletions: 0 })
    })

    it('rejoins paths that contain tabs', () => {
        const map = parseNumstatMap('1\t0\tdir/with\ttab.txt\n')
        expect(map.get('dir/with\ttab.txt')).toEqual({ additions: 1, deletions: 0 })
    })
})

describe('parseNameStatus', () => {
    it('joins the numstat entries by path and defaults missing stats', () => {
        const stats = new Map([['a.ts', { additions: 5, deletions: 2 }]])
        expect(parseNameStatus('M\ta.ts\nA\tnew.ts\n', stats)).toEqual([
            { path: 'a.ts', status: 'M', additions: 5, deletions: 2 },
            { path: 'new.ts', status: 'A', additions: 0, deletions: 0 },
        ])
    })
})

describe('parseMergeTreeOutput', () => {
    it('reports a clean merge', () => {
        expect(parseMergeTreeOutput('treeoid\n')).toEqual({ supported: true, fastForward: false, conflicts: [] })
    })

    it('collects --name-only conflict names', () => {
        const stdout = 'treeoid\na.txt\nb.txt\n\nCONFLICT (content): Merge conflict in a.txt\n'
        expect(parseMergeTreeOutput(stdout)).toEqual({ supported: true, fastForward: false, conflicts: ['a.txt', 'b.txt'] })
    })

    it('falls back to CONFLICT message lines when no names were printed', () => {
        const stdout = 'treeoid\n\nCONFLICT (content): Merge conflict in a.txt\n'
        expect(parseMergeTreeOutput(stdout)).toEqual({ supported: true, fastForward: false, conflicts: ['a.txt'] })
    })
})
