/* Lightweight syntax highlighter for diff lines.
   Produces HTML with <span> tokens. Supports JS/TS-family, CSS, JSON,
   Vue SFC (template/script/style sections), Python, shell and falls back
   to a generic mode. Multi-line block comments and template literals are
   tracked with a stateful walk (see highlightDiffLines). */

import type { DiffLine } from '@shared/types'

const KEYWORDS_JS = [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'class',
    'extends',
    'import',
    'export',
    'from',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'delete',
    'void',
    'yield',
    'static',
    'get',
    'set',
    'interface',
    'type',
    'enum',
    'implements',
    'public',
    'private',
    'protected',
    'readonly',
    'as',
    'satisfies',
    'null',
    'undefined',
    'true',
    'false',
    'declare',
    'namespace',
]
const KEYWORDS_PY = [
    'def',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'in',
    'import',
    'from',
    'class',
    'try',
    'except',
    'finally',
    'raise',
    'with',
    'as',
    'lambda',
    'pass',
    'break',
    'continue',
    'and',
    'or',
    'not',
    'is',
    'None',
    'True',
    'False',
    'self',
]
const KEYWORDS_SH = [
    'if',
    'then',
    'else',
    'fi',
    'for',
    'do',
    'done',
    'while',
    'case',
    'esac',
    'function',
    'echo',
    'exit',
    'return',
    'local',
    'export',
    'source',
]

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeHtml = (text: string) => text.replace(/[&<>]/g, ch => ESCAPES[ch])

type Mode = 'generic' | 'css' | 'json' | 'python' | 'shell' | 'vue'

function modeFor(filename: string): Mode {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    if (['css', 'scss', 'less'].includes(ext)) return 'css'
    if (ext === 'vue') return 'vue'
    if (['json', 'jsonc', 'json5'].includes(ext)) return 'json'
    if (ext === 'py') return 'python'
    if (['sh', 'bash', 'zsh'].includes(ext) || !filename.includes('.')) return 'shell'
    return 'generic'
}

function keywordsFor(mode: Mode): Set<string> {
    if (mode === 'python') return new Set(KEYWORDS_PY)
    if (mode === 'shell') return new Set(KEYWORDS_SH)
    return new Set(KEYWORDS_JS)
}

/* ---------------- multi-line state ---------------- */

/** State carried across the lines of one diff so block comments and
    template literals stay highlighted across line breaks. */
interface TokState {
    blockComment: boolean // inside /* … */ (script / style)
    htmlComment: boolean // inside <!-- … --> (template)
    htmlString: boolean // inside a multi-line attribute value (template)
    backtick: boolean // inside a `template literal` (script)
}

/** Which part of the file a line belongs to (Vue SFC sections; a fixed
    section for every other file type). */
type Section = 'template' | 'script' | 'style' | 'json' | 'other'

function sectionFor(filename: string): Section {
    const mode = modeFor(filename)
    if (mode === 'css') return 'style'
    if (mode === 'json') return 'json'
    if (mode === 'vue') return 'other'
    return 'script'
}

// SFC top-level blocks always start at column 0 — nested `<template v-if>`
// elements are indented and must NOT switch the section
const SECTION_OPEN = /^<(template|script|style)\b/
const SECTION_CLOSE = /^<\/(template|script|style)\s*>/

/** Guess the SFC section of a line when a diff hunk starts mid-file and no
    `<template>/<script>/<style>` tag has been seen yet. */
function guessSfcSection(content: string): Section {
    const t = content.trim()
    // HTML tag line (incl. comments `<!-- …` and doctype)
    if (t.startsWith('<')) return 'template'
    // template attribute line: `class="x"`, `:class="{ … }"`, `@click="…"`, bare `v-else`
    if (/^[\w@:#.-]+=["']/.test(t) || /^v-[\w:-]+(?!=)/.test(t) || t === '">') return 'template'
    // CSS property declaration (`color: var(--x);`) — but not TS `foo: () => void`
    if (/^[-\w-]+\s*:/.test(t) && !/=>|\?/.test(t)) return 'style'
    // CSS selector / custom-property line
    if (/^[.#][\w-]+/.test(t) || /^--[\w-]+\s*:/.test(t)) return 'style'
    return 'script'
}

/* ---------------- generic (JS/TS family, Python, shell) ---------------- */

const IDENT_START = /[A-Za-z_$]/
const IDENT = /[\w$]/

function findStringEnd(text: string, start: number): number {
    const quote = text[start]
    let i = start + 1
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2
            continue
        }
        if (text[i] === quote) return i
        i++
    }
    return -1
}

function genericWord(word: string, code: string, end: number, keywords: Set<string>): string {
    const escaped = escapeHtml(word)
    if (keywords.has(word)) return `<span class="tok-keyword">${escaped}</span>`
    // variable.language (this/super) — Simple Dark colors it like a constant
    if (word === 'this' || word === 'super') return `<span class="tok-number">${escaped}</span>`
    // identifier immediately followed by '(' — function/method name
    if (/^\s*\(/.test(code.slice(end))) return `<span class="tok-function">${escaped}</span>`
    // SCREAMING_SNAKE_CASE — module-level constant
    if (/^[A-Z][A-Z0-9_]*$/.test(word)) return `<span class="tok-type">${escaped}</span>`
    return escaped
}

/** Tokenize one script-style line, resuming/advancing multi-line state. */
function renderScript(content: string, state: TokState, keywords: Set<string>, hashComments: boolean): string {
    let out = ''
    let rest = content
    // resume a block comment opened on a previous line
    if (state.blockComment) {
        const end = rest.indexOf('*/')
        if (end === -1) return `<span class="tok-comment">${escapeHtml(rest)}</span>`
        out += `<span class="tok-comment">${escapeHtml(rest.slice(0, end + 2))}</span>`
        rest = rest.slice(end + 2)
        state.blockComment = false
    }
    // resume a template literal opened on a previous line
    if (state.backtick) {
        const end = rest.indexOf('`')
        if (end === -1) return `${out}<span class="tok-string">${escapeHtml(rest)}</span>`
        out += `<span class="tok-string">${escapeHtml(rest.slice(0, end + 1))}</span>`
        rest = rest.slice(end + 1)
        state.backtick = false
    }

    let i = 0
    let plain = ''
    const flush = () => {
        out += escapeHtml(plain)
        plain = ''
    }
    while (i < rest.length) {
        const ch = rest[i]!
        const two = rest.slice(i, i + 2)
        if ((hashComments && ch === '#' && two !== '#{') || two === '//') {
            flush()
            out += `<span class="tok-comment">${escapeHtml(rest.slice(i))}</span>`
            break
        }
        if (two === '/*') {
            const end = rest.indexOf('*/', i + 2)
            flush()
            if (end === -1) {
                out += `<span class="tok-comment">${escapeHtml(rest.slice(i))}</span>`
                state.blockComment = true
                break
            }
            out += `<span class="tok-comment">${escapeHtml(rest.slice(i, end + 2))}</span>`
            i = end + 2
            continue
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            flush()
            const end = findStringEnd(rest, i)
            if (end === -1) {
                out += `<span class="tok-string">${escapeHtml(rest.slice(i))}</span>`
                if (ch === '`') state.backtick = true
                break
            }
            out += `<span class="tok-string">${escapeHtml(rest.slice(i, end + 1))}</span>`
            i = end + 1
            continue
        }
        if (/[0-9]/.test(ch) && !(i > 0 && IDENT.test(rest[i - 1]!))) {
            flush()
            const m = /\d+(?:\.\d+)?/.exec(rest.slice(i))!
            out += `<span class="tok-number">${escapeHtml(m[0])}</span>`
            i += m[0].length
            continue
        }
        if (IDENT_START.test(ch)) {
            let j = i + 1
            while (j < rest.length && IDENT.test(rest[j]!)) j++
            const word = rest.slice(i, j)
            flush()
            out += genericWord(word, rest, j, keywords)
            i = j
            continue
        }
        plain += ch
        i++
    }
    flush()
    return out
}

/* ---------------- CSS ---------------- */

const CSS_VALUE_PATTERN =
    /(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(--[\w-]+|!important)|(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b)|(-?\d*\.?\d+(?:px|em|rem|ex|ch|vh|vw|vmin|vmax|%|s|ms|deg|grad|rad|turn|fr|pt|pc|in|cm|mm|q)?\b)|([A-Za-z_-][\w-]*)/g

function cssValues(code: string): string {
    let out = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = CSS_VALUE_PATTERN.exec(code)) !== null) {
        out += escapeHtml(code.slice(last, match.index))
        const [full, comment, str, kw, hex, num, word] = match
        if (comment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`
        else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`
        else if (kw) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`
        else if (hex || num) out += `<span class="tok-number">${escapeHtml(full)}</span>`
        else if (word) {
            // built-in CSS function call (var, rgba, color-mix, …)
            if (/^\s*\(/.test(code.slice(match.index + full.length))) {
                out += `<span class="tok-support">${escapeHtml(full)}</span>`
            } else {
                out += escapeHtml(full)
            }
        }
        last = match.index + full.length
    }
    out += escapeHtml(code.slice(last))
    return out
}

function cssDeclaration(code: string): string {
    const m = /^(\s*)([-\w]+)(\s*:)/.exec(code)
    if (!m) return cssValues(code)
    return `${escapeHtml(m[1])}<span class="tok-support">${escapeHtml(m[2])}</span>${escapeHtml(m[3])}${cssValues(code.slice(m[0].length))}`
}

const CSS_SELECTOR_PATTERN =
    /(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(:{1,2}[\w-]+)|([.#][-\w]+)|(@[\w-]+)|([A-Za-z_][\w-]*)/g

function cssSelector(code: string): string {
    let out = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = CSS_SELECTOR_PATTERN.exec(code)) !== null) {
        out += escapeHtml(code.slice(last, match.index))
        const [full, comment, str, pseudo, sel, at, word] = match
        if (comment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`
        else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`
        else if (pseudo || at) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`
        else if (sel) out += `<span class="tok-type">${escapeHtml(full)}</span>`
        else if (word) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`
        last = match.index + full.length
    }
    out += escapeHtml(code.slice(last))
    return out
}

function highlightCss(code: string): string {
    const trimmed = code.trim()
    // braces → selector/at-rule line (pseudo-selectors keep their ':' too)
    if (/[{}]/.test(trimmed)) return cssSelector(code)
    // `property: value;` — single-word head before the colon, no braces
    if (/^[-\w]+\s*:/.test(trimmed)) return cssDeclaration(code)
    // continuation of a multi-line value (e.g. under `transition:`) — colorize
    // numbers/functions but keep bare words plain instead of guessing selectors
    return cssValues(code)
}

/** CSS with block-comment state (comments spanning lines). */
function renderStyle(content: string, state: TokState): string {
    let rest = content
    if (state.blockComment) {
        const end = rest.indexOf('*/')
        if (end === -1) return `<span class="tok-comment">${escapeHtml(rest)}</span>`
        const out = `<span class="tok-comment">${escapeHtml(rest.slice(0, end + 2))}</span>`
        rest = rest.slice(end + 2)
        state.blockComment = false
        return out + renderStyle(rest, state)
    }
    const open = rest.indexOf('/*')
    if (open !== -1 && rest.indexOf('*/', open + 2) === -1) {
        state.blockComment = true
        return `${highlightCss(rest.slice(0, open))}<span class="tok-comment">${escapeHtml(rest.slice(open))}</span>`
    }
    return highlightCss(rest)
}

/* ---------------- HTML (Vue template) ---------------- */

const HTML_PATTERN =
    /(<!--.*?-->)|(<\/?[\w-]+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([@:#][\w.:-]+(?=\s*=)|v-[\w:-]+)|([\w-]+(?=\s*=))|(\/?>)/g

function findQuote(text: string, start: number): number {
    let i = start
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2
            continue
        }
        if (text[i] === '"') return i
        i++
    }
    return -1
}

/** Tokenize one template line, resuming/advancing HTML comment and
    multi-line attribute-value state. Tags → keyword, directives
    (@click/:class/v-if) → keyword, attribute names → type, values → string. */
function renderHtml(content: string, state: TokState): string {
    let out = ''
    let rest = content
    // resume an HTML comment opened on a previous line
    if (state.htmlComment) {
        const end = rest.indexOf('-->')
        if (end === -1) return `<span class="tok-comment">${escapeHtml(rest)}</span>`
        out += `<span class="tok-comment">${escapeHtml(rest.slice(0, end + 3))}</span>`
        rest = rest.slice(end + 3)
        state.htmlComment = false
    }
    // resume an attribute value opened on a previous line
    if (state.htmlString) {
        const end = findQuote(rest, 0)
        if (end === -1) return `<span class="tok-string">${escapeHtml(rest)}</span>`
        out += `<span class="tok-string">${escapeHtml(rest.slice(0, end + 1))}</span>`
        rest = rest.slice(end + 1)
        state.htmlString = false
        return out + renderHtml(rest, state)
    }
    // an unterminated `<!--` puts the remainder (and following lines) in a comment
    const open = rest.indexOf('<!--')
    if (open !== -1 && rest.indexOf('-->', open + 4) === -1) {
        state.htmlComment = true
        return `${renderHtml(rest.slice(0, open), state)}<span class="tok-comment">${escapeHtml(rest.slice(open))}</span>`
    }

    let last = 0
    let match: RegExpExecArray | null
    while ((match = HTML_PATTERN.exec(rest)) !== null) {
        out += escapeHtml(rest.slice(last, match.index))
        const [full, comment, tag, str, directive, attr, close] = match
        if (comment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`
        else if (tag || directive) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`
        else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`
        else if (attr) out += `<span class="tok-type">${escapeHtml(full)}</span>`
        else if (close) out += escapeHtml(full)
        last = match.index + full.length
    }

    // an attribute value left unclosed before the tag's `>` continues on the
    // next lines (e.g. `@click="` … `">`) — color the tail as a string
    const tail = rest.slice(last)
    const gt = tail.indexOf('>')
    const beforeClose = gt === -1 ? tail : tail.slice(0, gt)
    const q = beforeClose.indexOf('"')
    if (q === -1) {
        out += escapeHtml(tail)
    } else {
        state.htmlString = true
        out += `${escapeHtml(tail.slice(0, q))}<span class="tok-string">${escapeHtml(tail.slice(q))}</span>`
    }
    return out
}

/* ---------------- JSON ---------------- */

const JSON_PATTERN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b(?:true|false|null)\b)/g

function highlightJson(code: string): string {
    let out = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = JSON_PATTERN.exec(code)) !== null) {
        out += escapeHtml(code.slice(last, match.index))
        const [full, str, colon, num, kw] = match
        if (str) {
            // a string followed by ':' is a property name
            out += colon
                ? `<span class="tok-support">${escapeHtml(str)}</span>${escapeHtml(colon)}`
                : `<span class="tok-string">${escapeHtml(str)}</span>`
        } else if (num) out += `<span class="tok-number">${escapeHtml(full)}</span>`
        else if (kw) out += `<span class="tok-keyword">${escapeHtml(full)}</span>`
        last = match.index + full.length
    }
    out += escapeHtml(code.slice(last))
    return out
}

/* ---------------- section dispatch ---------------- */

function renderSegment(content: string, section: Section, state: TokState, keywords: Set<string>, hashComments: boolean): string {
    if (!content) return ''
    switch (section) {
        case 'template':
            return renderHtml(content, state)
        case 'style':
            return renderStyle(content, state)
        case 'json':
            return highlightJson(content)
        case 'script':
            return renderScript(content, state, keywords, hashComments)
        default:
            return escapeHtml(content)
    }
}

/* ---------------- entry points ---------------- */

/** Tokenize one line of code into escaped HTML with token classes.
    Stateless — use highlightDiffLines for multi-line constructs. */
export function highlightLine(code: string, filename: string): string {
    const mode = modeFor(filename)
    const state: TokState = { blockComment: false, htmlComment: false, htmlString: false, backtick: false }
    const section = sectionFor(filename)
    return renderSegment(code, section, state, keywordsFor(mode), mode === 'python' || mode === 'shell')
}

/**
 * Highlight a whole diff in one stateful walk, returning HTML per line.
 * Tracks Vue SFC sections (template/script/style) and multi-line block
 * comments / template literals. `render` lets the caller post-process each
 * line (e.g. word-diff <mark> ranges); its `highlight` callback tokenizes a
 * segment with the state the line started in.
 */
export function highlightDiffLines(
    lines: DiffLine[],
    filename: string,
    render: (line: DiffLine, highlight: (content: string) => string) => string
): Map<DiffLine, string> {
    const mode = modeFor(filename)
    const isSfc = mode === 'vue'
    const keywords = keywordsFor(mode)
    const hashComments = mode === 'python' || mode === 'shell'
    const state: TokState = { blockComment: false, htmlComment: false, htmlString: false, backtick: false }
    let section = sectionFor(filename)
    // once a real SFC section tag is seen, the file layout is known — stop guessing
    let tagged = !isSfc

    const map = new Map<DiffLine, string>()
    for (const line of lines) {
        if (line.type === 'hunk' || line.type === 'meta') {
            map.set(line, escapeHtml(line.text))
            continue
        }
        const content = line.text.slice(1)
        let initialSection = section
        const initialState: TokState = { ...state }
        if (content) {
            if (isSfc) {
                const open = SECTION_OPEN.exec(content)
                if (open) {
                    // the tag line itself renders as HTML; following lines use the section
                    initialSection = 'template'
                    section = open[1] as Section
                    tagged = true
                } else if (SECTION_CLOSE.test(content)) {
                    initialSection = 'template'
                    section = 'other'
                    tagged = true
                } else if (!tagged) {
                    // mid-file hunk with no section tag yet — guess per line;
                    // an open string/comment pins the section to template
                    initialSection =
                        state.htmlString || state.htmlComment ? 'template' : guessSfcSection(content)
                    section = initialSection
                }
            }
            // dry run on the full line advances multi-line state only
            renderSegment(content, initialSection, state, keywords, hashComments)
        }
        map.set(
            line,
            render(line, seg => renderSegment(seg, initialSection, { ...initialState }, keywords, hashComments))
        )
    }
    return map
}

/**
 * Compute intra-line changed regions between a deleted and an added line. Returns the middle (changed) segment bounds so UI can wrap them
 * in <mark>.
 */
export function intraLineRange(oldText: string, newText: string): { old: [number, number]; new: [number, number] } | null {
    let start = 0
    const minLen = Math.min(oldText.length, newText.length)
    while (start < minLen && oldText[start] === newText[start]) start++
    let endOld = oldText.length
    let endNew = newText.length
    while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
        endOld--
        endNew--
    }
    // only highlight when change is small relative to the line (looks tidy)
    if (endOld - start > 60 || endNew - start > 60) return null
    return { old: [start, endOld], new: [start, endNew] }
}

/** Render a diff content line (diff prefix stripped) with optional marked range. */
export function renderDiffContent(line: string, filename: string, mark?: [number, number] | null): string {
    const content = line.slice(1) // strip +/- marker (or the context-line space)
    if (!content) return '' // empty added/removed line — draw nothing, never the +/- glyph
    if (!mark) return highlightLine(content, filename)
    const start = Math.min(mark[0], content.length)
    const end = Math.min(mark[1], content.length)
    if (end <= start) return highlightLine(content, filename)
    return [
        highlightLine(content.slice(0, start), filename),
        `<mark>${highlightLine(content.slice(start, end), filename)}</mark>`,
        highlightLine(content.slice(end), filename),
    ].join('')
}

/**
 * True when a del/add pair differs only in whitespace (indent / format churn) —
 * the collapsed-and-trimmed texts are identical.
 */
export function isWhitespaceOnlyChange(oldText: string, newText: string): boolean {
    const collapse = (text: string) => text.slice(1).replace(/\s+/g, ' ').trim()
    return collapse(oldText) === collapse(newText)
}

/**
 * Detect lines that were MOVED (deleted from one spot and re-added unmodified
 * elsewhere) instead of genuinely changed. Returns the set of both the del and
 * add lines involved so the UI can render them as "moved" rather than -/+.
 *
 * A del only pairs with an add whose index lies OUTSIDE the del…add block the
 * del itself belongs to — the adjacent del/add pair of a real modification
 * never counts as a move. First match wins; each line is consumed at most once.
 */
export function detectMovedLines(lines: DiffLine[]): Set<DiffLine> {
    const moved = new Set<DiffLine>()
    const addsByKey = new Map<string, number[]>()
    lines.forEach((line, index) => {
        if (line.type !== 'add') return
        const key = line.text.slice(1).trimEnd()
        const list = addsByKey.get(key)
        if (list) list.push(index)
        else addsByKey.set(key, [index])
    })
    lines.forEach((line, index) => {
        if (line.type !== 'del') return
        // extent of the del…add block this del belongs to
        let blockEnd = index
        while (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'del') blockEnd++
        if (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'add') {
            while (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'add') blockEnd++
        }
        const list = addsByKey.get(line.text.slice(1).trimEnd())
        if (!list?.length) return
        const match = list.findIndex(candidate => candidate < index || candidate > blockEnd)
        if (match === -1) return
        const addIndex = list.splice(match, 1)[0]
        moved.add(line)
        moved.add(lines[addIndex])
    })
    return moved
}
