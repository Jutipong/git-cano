import type { CommitNode, DiffLine } from '@shared/types'

/**
 * Pure git-output parsers shared by the main process. Kept free of electron/simple-git imports so they can be
 * unit-tested directly (see tests/unit/parsers.test.ts).
 */

export function normalizeRef(raw: string): string | null {
    const s = raw.trim()
    if (!s) return null
    if (s.startsWith('HEAD -> ')) {
        const target = s.slice('HEAD -> '.length).trim()
        return `HEAD -> ${target.replace(/^refs\/heads\//, '')}`
    }
    if (s.startsWith('tag:')) {
        const name = s
            .slice(4)
            .trim()
            .replace(/\^\{\}$/, '')
            .replace(/^refs\/tags\//, '')
        return `tag: ${name}`
    }
    if (s.startsWith('refs/tags/')) return `tag: ${s.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')}`
    if (s.startsWith('refs/remotes/')) {
        const short = s.replace(/^refs\/remotes\//, '')
        if (!short || short.endsWith('/HEAD')) return null
        return `remote:${short}`
    }
    if (s.startsWith('refs/heads/')) return s.replace(/^refs\/heads\//, '')
    if (s.endsWith('/HEAD')) return null
    return s
}

export function parseLog(text: string): CommitNode[] {
    const SEP = '\x1f'
    const REC = '\x1e'
    const commits: CommitNode[] = []
    for (const line of text.split(REC)) {
        const t = line.replace(/^\n/, '')
        if (!t.trim()) continue
        const [hash, parents, shortHash, author, authorEmail, date, refsRaw, subject, bodyMark] = t.split(SEP)
        const refs = refsRaw
            ? refsRaw
                  .trim()
                  .replace(/^\(/, '')
                  .replace(/\)$/, '')
                  .split(',')
                  .map(normalizeRef)
                  .filter((ref): ref is string => !!ref)
            : []
        commits.push({
            hash,
            shortHash,
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            author,
            authorEmail: authorEmail || undefined,
            date,
            subject,
            // Only a presence marker travels with the log (`%<(1,trunc)%b`); the full body is lazy-loaded
            // through getCommitBody() when the message popover expands.
            hasBody: bodyMark?.trim() ? true : undefined,
            refs,
            lane: 0,
        })
    }
    return commits
}

/**
 * Hard cap on the diff payload sent to the renderer. Whole-file views ("show entire file", untracked files, unchanged-file
 * snapshots) otherwise turn a large file into one DiffLine object per line on both sides of the IPC; past the cap the list
 * is cut with a visible marker instead of driving the app into swap.
 */
export const MAX_DIFF_LINES = 20_000
export function capDiffLines(lines: DiffLine[]): DiffLine[] {
    if (lines.length <= MAX_DIFF_LINES) return lines
    return [
        ...lines.slice(0, MAX_DIFF_LINES),
        {
            type: 'meta',
            oldNo: null,
            newNo: null,
            text: `… truncated — ${lines.length - MAX_DIFF_LINES} more lines not shown (view too large)`,
        },
    ]
}

export function parseDiff(text: string, file?: string): DiffLine[] {
    const lines: DiffLine[] = file ? [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }] : []
    let oldNo = 0
    let newNo = 0

    for (const line of text.split('\n')) {
        if (
            line.startsWith('diff ') ||
            line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('similarity ') ||
            line.startsWith('rename ')
        ) {
            continue
        }
        if (line.startsWith('@@')) {
            const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
            oldNo = m ? parseInt(m[1], 10) : 0
            newNo = m ? parseInt(m[2], 10) : 0
            lines.push({ type: 'hunk', oldNo: null, newNo: null, text: line })
        } else if (line.startsWith('+')) {
            lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: line })
        } else if (line.startsWith('-')) {
            lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line })
        } else if (line.startsWith(' ')) {
            lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line })
        } else if (line.startsWith('\\')) {
            lines.push({ type: 'meta', oldNo: null, newNo: null, text: line })
        }
    }
    return lines
}

/**
 * Escapes the gitignore glob metacharacters (`\ * ? [ ]`) so a path can be written as a literal rule. Windows
 * allows `[`/`]` in file and folder names, and an unescaped `[1]` is read as a character class — the rule then
 * never matches the intended file (and may match an unrelated one like `1`).
 */
export function escapeGitignorePath(relativePath: string): string {
    return relativePath.replace(/[\\*?[\]]/g, '\\$&')
}

/**
 * Per-section cap for AI prompt context. The final prompt is truncated to 16k chars in opencode.ts anyway,
 * so a multi-megabyte diff is cut here before extra full-size string copies pile up in `parts`.
 */
export const AI_CONTEXT_SECTION_MAX = 20_000
export function capContextSection(text: string): string {
    if (text.length <= AI_CONTEXT_SECTION_MAX) return text
    const cut = text.lastIndexOf('\n', AI_CONTEXT_SECTION_MAX)
    return `${text.slice(0, cut > 0 ? cut : AI_CONTEXT_SECTION_MAX)}\n… (truncated)`
}
