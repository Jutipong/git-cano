/* Lightweight syntax highlighter for diff lines.
   Produces HTML with <span> tokens. Supports JS/TS-family, CSS, JSON,
   Python, shell and falls back to a generic mode. */

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

type Mode = 'generic' | 'css' | 'json' | 'python' | 'shell'

function modeFor(filename: string): Mode {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    if (['css', 'scss', 'less'].includes(ext)) return 'css'
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

/* ---------------- generic (JS/TS family, Python, shell) ---------------- */

const GENERIC_PATTERN =
    /(\/\/.*$|#(?!\{).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g

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

function highlightGeneric(code: string, keywords: Set<string>): string {
    let out = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = GENERIC_PATTERN.exec(code)) !== null) {
        out += escapeHtml(code.slice(last, match.index))
        const [full, comment, str, num, word] = match
        if (comment) out += `<span class="tok-comment">${escapeHtml(full)}</span>`
        else if (str) out += `<span class="tok-string">${escapeHtml(full)}</span>`
        else if (num) out += `<span class="tok-number">${escapeHtml(full)}</span>`
        else if (word) out += genericWord(word, code, match.index + full.length, keywords)
        last = match.index + full.length
    }
    out += escapeHtml(code.slice(last))
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

/* ---------------- entry point ---------------- */

/** Tokenize one line of code into escaped HTML with token classes. */
export function highlightLine(code: string, filename: string): string {
    const mode = modeFor(filename)
    if (mode === 'css') return highlightCss(code)
    if (mode === 'json') return highlightJson(code)
    return highlightGeneric(code, keywordsFor(mode))
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
