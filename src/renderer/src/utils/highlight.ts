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
const KEYWORDS_GO = [
    'package',
    'import',
    'func',
    'return',
    'if',
    'else',
    'for',
    'range',
    'switch',
    'case',
    'default',
    'break',
    'continue',
    'struct',
    'interface',
    'type',
    'map',
    'chan',
    'const',
    'var',
    'go',
    'defer',
    'select',
    'goto',
    'fallthrough',
    'iota',
]
const KEYWORDS_RUST = [
    'fn',
    'return',
    'if',
    'else',
    'for',
    'while',
    'loop',
    'in',
    'match',
    'break',
    'continue',
    'struct',
    'enum',
    'impl',
    'trait',
    'type',
    'where',
    'use',
    'mod',
    'pub',
    'crate',
    'mut',
    'const',
    'static',
    'let',
    'move',
    'ref',
    'dyn',
    'async',
    'await',
    'unsafe',
    'extern',
    'as',
    'try',
    'yield',
    'union',
    'macro_rules',
]
const KEYWORDS_JAVA = [
    'package',
    'import',
    'class',
    'interface',
    'enum',
    'extends',
    'implements',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'default',
    'break',
    'continue',
    'new',
    'try',
    'catch',
    'finally',
    'throw',
    'throws',
    'synchronized',
    'volatile',
    'transient',
    'static',
    'final',
    'abstract',
    'public',
    'private',
    'protected',
    'native',
    'strictfp',
    'assert',
    'instanceof',
    'var',
    'record',
    'sealed',
    'permits',
    'void',
    'int',
    'long',
    'short',
    'byte',
    'char',
    'float',
    'double',
    'boolean',
]

// Simple Dark `constant` / `variable.language` scope — purple #BD93F9, not keywords.
const CONSTANT_WORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'None', 'True', 'False', 'nil', 'NULL'])

// Simple Dark `support.*` scope — cyan #8BE9FD (builtin functions).
const SUPPORT_PY = new Set([
    'print',
    'len',
    'range',
    'str',
    'int',
    'float',
    'bool',
    'list',
    'dict',
    'set',
    'tuple',
    'open',
    'enumerate',
    'zip',
    'min',
    'max',
    'sum',
    'abs',
    'repr',
    'type',
    'isinstance',
    'hasattr',
    'getattr',
    'setattr',
    'callable',
    'iter',
    'next',
    'object',
])
const SUPPORT_GO = new Set([
    'new',
    'make',
    'len',
    'cap',
    'append',
    'copy',
    'delete',
    'panic',
    'recover',
    'print',
    'println',
    'close',
    'clear',
    'min',
    'max',
])
const SUPPORT_EMPTY = new Set<string>()

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeHtml = (text: string) => text.replace(/[&<>]/g, ch => ESCAPES[ch])

type Mode = 'generic' | 'css' | 'json' | 'python' | 'shell' | 'vue' | 'go' | 'rust' | 'java'

function modeFor(filename: string): Mode {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
    if (['css', 'scss', 'less'].includes(ext)) return 'css'
    if (ext === 'vue') return 'vue'
    if (['json', 'jsonc', 'json5'].includes(ext)) return 'json'
    if (ext === 'py') return 'python'
    if (ext === 'go') return 'go'
    if (ext === 'rs') return 'rust'
    if (ext === 'java') return 'java'
    if (['sh', 'bash', 'zsh'].includes(ext) || !filename.includes('.')) return 'shell'
    return 'generic'
}

function keywordsFor(mode: Mode): Set<string> {
    if (mode === 'python') return new Set(KEYWORDS_PY)
    if (mode === 'shell') return new Set(KEYWORDS_SH)
    if (mode === 'go') return new Set(KEYWORDS_GO)
    if (mode === 'rust') return new Set(KEYWORDS_RUST)
    if (mode === 'java') return new Set(KEYWORDS_JAVA)
    return new Set(KEYWORDS_JS)
}

function supportsFor(mode: Mode): Set<string> {
    if (mode === 'python') return SUPPORT_PY
    if (mode === 'go') return SUPPORT_GO
    return SUPPORT_EMPTY
}

interface TokState {
    blockComment: boolean
    htmlComment: boolean
    htmlString: boolean
    backtick: boolean
    paramDepth: number
}

type Section = 'template' | 'script' | 'style' | 'json' | 'other'

function sectionFor(filename: string): Section {
    const mode = modeFor(filename)
    if (mode === 'css') return 'style'
    if (mode === 'json') return 'json'
    if (mode === 'vue') return 'other'
    return 'script'
}

const SECTION_OPEN = /^<(template|script|style)\b/
const SECTION_CLOSE = /^<\/(template|script|style)\s*>/

function guessSfcSection(content: string): Section {
    const t = content.trim()
    if (t.startsWith('<')) return 'template'
    if (/^[\w@:#.-]+=["']/.test(t) || /^v-[\w:-]+(?!=)/.test(t) || t === '">') return 'template'
    if (/^[-\w-]+\s*:/.test(t) && !/=>|\?/.test(t)) return 'style'
    if (/^[.#][\w-]+/.test(t) || /^--[\w-]+\s*:/.test(t)) return 'style'
    return 'script'
}

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

function genericWord(word: string, code: string, end: number, keywords: Set<string>, supports: Set<string>): string {
    const escaped = escapeHtml(word)
    if (keywords.has(word)) return `<span class="tok-keyword">${escaped}</span>`
    if (word === 'this' || word === 'super' || word === 'self' || word === 'Self' || CONSTANT_WORDS.has(word))
        return `<span class="tok-number">${escaped}</span>`
    if (supports.has(word)) return `<span class="tok-support">${escaped}</span>`
    // PascalCase / ALL_CAPS before call-check: constructors and type references are
    // Simple Dark `entity.name.type` (blue), not functions.
    if (/^[A-Z][\w$]*$/.test(word)) return `<span class="tok-type">${escaped}</span>`
    if (/^\s*\(/.test(code.slice(end))) return `<span class="tok-function">${escaped}</span>`
    return escaped
}

/** String-aware forward match for the `)` closing the `(` at openIdx; -1 if none on this line. */
function matchParen(text: string, openIdx: number): number {
    let depth = 0
    let quote: string | null = null
    for (let k = openIdx; k < text.length; k++) {
        const c = text[k]!
        if (quote) {
            if (c === '\\') {
                k++
                continue
            }
            if (c === quote) quote = null
            continue
        }
        if (c === '"' || c === "'" || c === '`') {
            quote = c
            continue
        }
        if (c === '(') depth++
        else if (c === ')') {
            depth--
            if (depth === 0) return k
        }
    }
    return -1
}

/**
 * True when the `(` at openIdx opens a _definition_ parameter list: `function f(` / `func f(` / `fn f(` / `def f(` / `= (` / `= async (` /
 * `(a, b) =>`. Call-site parens (`foo(`, `if (`, `x = f(`) return false so arguments keep base color, matching Simple Dark where only
 * `variable.parameter` is orange.
 */
function isDefParen(text: string, openIdx: number): boolean {
    const before = text.slice(0, openIdx)
    if (/\b(?:function|def|func|fn)(?![\w$])\s*[\w$]*\s*$/.test(before)) return true
    if (/(?:^|[^=!<>|&?])=\s*(?:async\s+)?$/.test(before)) return true
    const close = matchParen(text, openIdx)
    if (close !== -1 && /^\s*=>/.test(text.slice(close + 1))) return true
    return false
}

function renderTemplate(raw: string, keywords: Set<string>, supports: Set<string>, hashComments: boolean): string {
    let out = ''
    let idx = 0
    while (idx < raw.length) {
        const start = raw.indexOf('${', idx)
        if (start === -1) {
            out += `<span class="tok-string">${escapeHtml(raw.slice(idx))}</span>`
            break
        }
        if (start > idx) out += `<span class="tok-string">${escapeHtml(raw.slice(idx, start))}</span>`
        let depth = 1
        let k = start + 2
        let quote: string | null = null
        while (k < raw.length && depth > 0) {
            const c = raw[k]!
            if (quote) {
                if (c === '\\') {
                    k += 2
                    continue
                }
                if (c === quote) quote = null
                k++
                continue
            }
            if (c === '"' || c === "'" || c === '`') {
                quote = c
                k++
                continue
            }
            if (c === '{') depth++
            else if (c === '}') depth--
            k++
        }
        const closed = depth === 0
        const inner = raw.slice(start + 2, closed ? k - 1 : raw.length)
        const tmp: TokState = { blockComment: false, htmlComment: false, htmlString: false, backtick: false, paramDepth: 0 }
        out += `\${${renderScript(inner, tmp, keywords, supports, hashComments)}${closed ? '}' : ''}`
        idx = k
    }
    return out
}

const NUMBER_PATTERN = /0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?n?/
const REGEX_PATTERN = /\/(?:[^\\/\n[]|\\.|\[[^\]\n]*])+\/[gimsuy]*/
const REGEX_PREV = /[=(:,[!&|?{};]/
const REGEX_PREV_KEYWORD = /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\b\s*$/

function renderScript(content: string, state: TokState, keywords: Set<string>, supports: Set<string>, hashComments: boolean): string {
    let out = ''
    let rest = content
    if (state.blockComment) {
        const end = rest.indexOf('*/')
        if (end === -1) return `<span class="tok-comment">${escapeHtml(rest)}</span>`
        out += `<span class="tok-comment">${escapeHtml(rest.slice(0, end + 2))}</span>`
        rest = rest.slice(end + 2)
        state.blockComment = false
    }
    if (state.backtick) {
        const end = rest.indexOf('`')
        if (end === -1) return `${out}<span class="tok-string">${escapeHtml(rest)}</span>`
        out += `<span class="tok-string">${escapeHtml(rest.slice(0, end + 1))}</span>`
        rest = rest.slice(end + 1)
        state.backtick = false
    }

    let i = 0
    let plain = ''
    let paramDepth = state.paramDepth || 0
    const flush = () => {
        out += escapeHtml(plain)
        plain = ''
    }
    const syncParams = () => {
        state.paramDepth = paramDepth
    }
    while (i < rest.length) {
        const ch = rest[i]!
        const two = rest.slice(i, i + 2)
        if ((hashComments && ch === '#' && two !== '#{') || two === '//') {
            flush()
            out += `<span class="tok-comment">${escapeHtml(rest.slice(i))}</span>`
            syncParams()
            break
        }
        if (two === '/*') {
            const end = rest.indexOf('*/', i + 2)
            flush()
            if (end === -1) {
                out += `<span class="tok-comment">${escapeHtml(rest.slice(i))}</span>`
                state.blockComment = true
                syncParams()
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
                syncParams()
                break
            }
            const raw = rest.slice(i, end + 1)
            // Template literal: string green outside, real code colors inside ${...}.
            out +=
                ch === '`' && raw.includes('${')
                    ? renderTemplate(raw, keywords, supports, hashComments)
                    : `<span class="tok-string">${escapeHtml(raw)}</span>`
            i = end + 1
            continue
        }
        // Regex literal (Simple Dark `string.regexp`, green): only where a value is
        // expected, so `a / b` division stays plain.
        if (ch === '/' && two !== '//' && two !== '/*') {
            const prev = rest.slice(0, i).replace(/\s+$/, '')
            const prevCh = prev.slice(-1)
            if (!prevCh || REGEX_PREV.test(prevCh) || REGEX_PREV_KEYWORD.test(prev)) {
                const m = REGEX_PATTERN.exec(rest.slice(i))
                if (m && m[0].length > 2) {
                    flush()
                    out += `<span class="tok-function">${escapeHtml(m[0])}</span>`
                    i += m[0].length
                    continue
                }
            }
        }
        if (/[0-9]/.test(ch) && !(i > 0 && IDENT.test(rest[i - 1]!))) {
            flush()
            const m = NUMBER_PATTERN.exec(rest.slice(i))!
            out += `<span class="tok-number">${escapeHtml(m[0])}</span>`
            i += m[0].length
            continue
        }
        if (IDENT_START.test(ch)) {
            let j = i + 1
            while (j < rest.length && IDENT.test(rest[j]!)) j++
            const word = rest.slice(i, j)
            flush()
            // Definition parameters (Simple Dark `variable.parameter`, orange).
            // Type names, constants and `this`/`super` keep their own colors.
            if (
                paramDepth > 0 &&
                !keywords.has(word) &&
                !supports.has(word) &&
                !CONSTANT_WORDS.has(word) &&
                word !== 'this' &&
                word !== 'super' &&
                word !== 'self' &&
                word !== 'Self' &&
                !/^[A-Z]/.test(word)
            ) {
                out += `<span class="tok-param">${escapeHtml(word)}</span>`
            } else {
                out += genericWord(word, rest, j, keywords, supports)
            }
            i = j
            continue
        }
        if (ch === '(') {
            if (paramDepth === 0 && isDefParen(rest, i)) paramDepth = 1
            else if (paramDepth > 0) paramDepth++
            plain += ch
            i++
            continue
        }
        if (ch === ')' && paramDepth > 0) {
            paramDepth--
            plain += ch
            i++
            continue
        }
        plain += ch
        i++
    }
    flush()
    syncParams()
    return out
}

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

const CSS_SELECTOR_PATTERN = /(\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(:{1,2}[\w-]+)|([.#][-\w]+)|(@[\w-]+)|([A-Za-z_][\w-]*)/g

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
    if (/[{}]/.test(trimmed)) return cssSelector(code)
    if (/^[-\w]+\s*:/.test(trimmed)) return cssDeclaration(code)
    return cssValues(code)
}

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

function renderHtml(content: string, state: TokState): string {
    let out = ''
    let rest = content
    if (state.htmlComment) {
        const end = rest.indexOf('-->')
        if (end === -1) return `<span class="tok-comment">${escapeHtml(rest)}</span>`
        out += `<span class="tok-comment">${escapeHtml(rest.slice(0, end + 3))}</span>`
        rest = rest.slice(end + 3)
        state.htmlComment = false
    }
    if (state.htmlString) {
        const end = findQuote(rest, 0)
        if (end === -1) return `<span class="tok-string">${escapeHtml(rest)}</span>`
        out += `<span class="tok-string">${escapeHtml(rest.slice(0, end + 1))}</span>`
        rest = rest.slice(end + 1)
        state.htmlString = false
        return out + renderHtml(rest, state)
    }
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

const JSON_PATTERN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b(?:true|false|null)\b)/g

function highlightJson(code: string): string {
    let out = ''
    let last = 0
    let match: RegExpExecArray | null
    while ((match = JSON_PATTERN.exec(code)) !== null) {
        out += escapeHtml(code.slice(last, match.index))
        const [full, str, colon, num, kw] = match
        if (str) {
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

function renderSegment(
    content: string,
    section: Section,
    state: TokState,
    keywords: Set<string>,
    supports: Set<string>,
    hashComments: boolean
): string {
    if (!content) return ''
    switch (section) {
        case 'template':
            return renderHtml(content, state)
        case 'style':
            return renderStyle(content, state)
        case 'json':
            return highlightJson(content)
        case 'script':
            return renderScript(content, state, keywords, supports, hashComments)
        default:
            return escapeHtml(content)
    }
}

export function highlightLine(code: string, filename: string): string {
    const mode = modeFor(filename)
    const state: TokState = { blockComment: false, htmlComment: false, htmlString: false, backtick: false, paramDepth: 0 }
    const section = sectionFor(filename)
    return renderSegment(code, section, state, keywordsFor(mode), supportsFor(mode), mode === 'python' || mode === 'shell')
}

export interface LineRenderContext {
    section: Section
    state: TokState
    keywords: Set<string>
    supports: Set<string>
    hashComments: boolean
}

/**
 * Single sequential pass over a diff that advances the tokenizer state line by line and records each line's initial (section, state) —
 * cheap: no HTML is built here. The per-line contexts let callers highlight only the lines they actually render (virtual scrolling) while
 * keeping cross-line state (block comments, backticks, SFC sections) correct.
 */
export function computeLineStates(lines: DiffLine[], filename: string): LineRenderContext[] {
    const mode = modeFor(filename)
    const isSfc = mode === 'vue'
    const keywords = keywordsFor(mode)
    const supports = supportsFor(mode)
    const hashComments = mode === 'python' || mode === 'shell'
    const state: TokState = { blockComment: false, htmlComment: false, htmlString: false, backtick: false, paramDepth: 0 }
    let section = sectionFor(filename)
    let tagged = !isSfc
    const contexts: LineRenderContext[] = []
    for (const line of lines) {
        const content = line.text.slice(1)
        let initialSection = section
        const initialState: TokState = { ...state }
        if (line.type !== 'hunk' && line.type !== 'meta' && content) {
            if (isSfc) {
                const open = SECTION_OPEN.exec(content)
                if (open) {
                    initialSection = 'template'
                    section = open[1] as Section
                    tagged = true
                } else if (SECTION_CLOSE.test(content)) {
                    initialSection = 'template'
                    section = 'other'
                    tagged = true
                } else if (!tagged) {
                    initialSection = state.htmlString || state.htmlComment ? 'template' : guessSfcSection(content)
                    section = initialSection
                }
            }
            renderSegment(content, initialSection, state, keywords, supports, hashComments)
        }
        contexts.push({ section: initialSection, state: initialState, keywords, supports, hashComments })
    }
    return contexts
}

/** Highlights a single line using the sequential context recorded by computeLineStates. */
export function highlightLineAt(
    line: DiffLine,
    context: LineRenderContext,
    render: (line: DiffLine, highlight: (content: string) => string) => string
): string {
    if (line.type === 'hunk' || line.type === 'meta') return escapeHtml(line.text)
    return render(line, seg =>
        renderSegment(seg, context.section, { ...context.state }, context.keywords, context.supports, context.hashComments)
    )
}

export type TextRange = [number, number]

interface DiffToken {
    text: string
    start: number
    end: number
    weight: number
}

const MAX_DIFF_TOKENS = 256
/** Token budget for the windowed fallback used by generated/minified lines. */
const MAX_DIFF_WINDOW_TOKENS = 512
/** Blocks above these sizes skip word-level matching entirely so huge rewrites stay cheap. */
const MAX_MATCH_LINES = 250
const MAX_MATCH_PAIRS = 12_000

/** True for characters that carry meaning; punctuation and whitespace change constantly and score low. */
const WEIGHTY_CHAR = /[\p{L}\p{N}_$]/u
const CHAR_WEIGHT = 0.3
const TOKEN_WEIGHT = 1

function diffTokens(text: string): DiffToken[] {
    const tokens: DiffToken[] = []
    const pattern = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
        let weight = 0
        for (const char of match[0]) weight += WEIGHTY_CHAR.test(char) ? TOKEN_WEIGHT : CHAR_WEIGHT
        tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length, weight })
    }
    return tokens
}

function mergeTextRanges(ranges: TextRange[]): TextRange[] {
    const merged: TextRange[] = []
    for (const range of ranges) {
        const previous = merged[merged.length - 1]
        if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1])
        else if (range[1] > range[0]) merged.push([...range])
    }
    return merged
}

/** Marks the token runs that differ, optionally shifting the ranges back to the original string offsets. */
function substituteLines(
    oldTokens: DiffToken[],
    newTokens: DiffToken[],
    threshold: number,
    oldDelta = 0,
    newDelta = 0
): { ranges: { old: TextRange[]; new: TextRange[] }; similarity: number } {
    let oldWeight = 0
    let newWeight = 0
    for (const token of oldTokens) oldWeight += token.weight
    for (const token of newTokens) newWeight += token.weight
    const denominator = Math.max(oldWeight, newWeight)

    const lcs = Array.from({ length: oldTokens.length + 1 }, () => new Uint16Array(newTokens.length + 1))
    for (let oldIndex = 1; oldIndex <= oldTokens.length; oldIndex++) {
        for (let newIndex = 1; newIndex <= newTokens.length; newIndex++) {
            lcs[oldIndex]![newIndex] =
                oldTokens[oldIndex - 1]!.text === newTokens[newIndex - 1]!.text
                    ? lcs[oldIndex - 1]![newIndex - 1]! + 1
                    : Math.max(lcs[oldIndex - 1]![newIndex]!, lcs[oldIndex]![newIndex - 1]!)
        }
    }

    const matchedOld = new Set<number>()
    const matchedNew = new Set<number>()
    let unchangedWeight = 0
    let oldIndex = oldTokens.length
    let newIndex = newTokens.length
    while (oldIndex > 0 && newIndex > 0) {
        if (oldTokens[oldIndex - 1]!.text === newTokens[newIndex - 1]!.text) {
            matchedOld.add(oldIndex - 1)
            matchedNew.add(newIndex - 1)
            unchangedWeight += oldTokens[oldIndex - 1]!.weight
            oldIndex--
            newIndex--
        } else if (lcs[oldIndex - 1]![newIndex]! >= lcs[oldIndex]![newIndex - 1]!) oldIndex--
        else newIndex--
    }

    const similarity = denominator ? unchangedWeight / denominator : 0
    if (similarity <= threshold) return { ranges: { old: [], new: [] }, similarity }
    const oldRanges = mergeTextRanges(
        oldTokens.filter((_, index) => !matchedOld.has(index)).map(token => [token.start + oldDelta, token.end + oldDelta] as TextRange)
    )
    const newRanges = mergeTextRanges(
        newTokens.filter((_, index) => !matchedNew.has(index)).map(token => [token.start + newDelta, token.end + newDelta] as TextRange)
    )
    return { ranges: { old: oldRanges, new: newRanges }, similarity }
}

/** Minimal {start, end} window around the changed region, or null when the whole lines differ. */
function diffWindow(oldText: string, newText: string): { oldStart: number; oldEnd: number; newStart: number; newEnd: number } | null {
    let prefix = 0
    const minLength = Math.min(oldText.length, newText.length)
    while (prefix < minLength && oldText[prefix] === newText[prefix]) prefix++

    // Trim the common suffix without letting it collide with the prefix.
    const suffixLimit = minLength - prefix
    let suffix = 0
    while (suffix < suffixLimit && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++

    const oldFragment = oldText.length - prefix - suffix
    const newFragment = newText.length - prefix - suffix
    if (oldFragment <= 0 || newFragment <= 0) return null
    const margin = Math.max(0, Math.ceil(Math.max(oldFragment, newFragment) / 2))
    const oldStart = Math.max(0, prefix - margin)
    const oldEnd = Math.min(oldText.length, oldText.length - suffix + margin)
    const newStart = Math.max(0, prefix - margin)
    const newEnd = Math.min(newText.length, newText.length - suffix + margin)
    return { oldStart, oldEnd, newStart, newEnd }
}

/**
 * Similarity between two changed lines plus the ranges that differ, when the lines are similar enough to be a renamed or
 * edited counterpart rather than two unrelated rows. Punctuation and whitespace weigh less so shared syntax alone cannot
 * make unrelated declarations look related. Pre-tokenized lines reuse their tokens; oversized generated lines fall back
 * to a bounded window around the changed region so they can still receive word-level marks.
 */
function lineSimilarity(
    oldLine: DiffLine,
    newLine: DiffLine,
    oldTokens: DiffToken[] | undefined,
    newTokens: DiffToken[] | undefined,
    threshold: number
): { similarity: number; old: TextRange[]; new: TextRange[] } {
    // Cheap upper bound: the length ratio caps how similar two lines can be, so very unequal lines
    // skip the LCS work without changing the outcome.
    const oldText = oldLine.text.slice(1)
    const newText = newLine.text.slice(1)
    const minLength = Math.min(oldText.length, newText.length)
    const maxLength = Math.max(oldText.length, newText.length)
    if (!maxLength || minLength / maxLength <= threshold) return { similarity: 0, old: [], new: [] }

    if (oldTokens && newTokens) {
        const result = substituteLines(oldTokens, newTokens, threshold)
        return { similarity: result.similarity, ...result.ranges }
    }

    const window = diffWindow(oldText, newText)
    if (window) {
        // Cheap prefilter: the trimmed fragments are what actually differs, so when the changed
        // fragment is a small part of a longer line the pair cannot clear the threshold anyway.
        const oldFragment = oldText.slice(window.oldStart, window.oldEnd)
        const newFragment = newText.slice(window.newStart, window.newEnd)
        const fragmentRatio = Math.min(oldFragment.length, newFragment.length) / Math.max(oldFragment.length, newFragment.length)
        if (fragmentRatio <= threshold) return { similarity: 0, old: [], new: [] }
        const oldWindowTokens = diffTokens(oldFragment)
        const newWindowTokens = diffTokens(newFragment)
        if (oldWindowTokens.length <= MAX_DIFF_WINDOW_TOKENS && newWindowTokens.length <= MAX_DIFF_WINDOW_TOKENS) {
            const result = substituteLines(oldWindowTokens, newWindowTokens, threshold, window.oldStart, window.newStart)
            return { similarity: result.similarity, ...result.ranges }
        }
    }
    return { similarity: 0, old: [], new: [] }
}

// Below this similarity two lines of a del/add block are treated as unrelated (a removed `Memo = dto.memo` next to an
// added `PayDate = dto.paydate`), so only their row background shows and no misleading word-level mark appears.
const MIN_LINE_SIMILARITY = 0.4

/**
 * Pairs deleted lines with their most similar added lines inside one del/add block. Matching is greedy and order
 * preserving, so marks never cross, and a line without a similar counterpart keeps just the row background. Blocks whose
 * candidate pairs would make the matching quadratic (for example a whole-file rewrite) are skipped entirely.
 */
export function markChangedLines(deleted: DiffLine[], added: DiffLine[]): Map<DiffLine, TextRange[]> {
    const marks = new Map<DiffLine, TextRange[]>()
    if (!deleted.length || !added.length) return marks
    if (deleted.length > MAX_MATCH_LINES || added.length > MAX_MATCH_LINES) return marks
    if (deleted.length * added.length > MAX_MATCH_PAIRS) return marks

    // Tokenize each line once; oversized generated lines stay without tokens and use the windowed path per pair.
    const tokens = new Map<DiffLine, DiffToken[]>()
    for (const line of [...deleted, ...added]) {
        const content = line.text.slice(1)
        const lineTokens = diffTokens(content)
        if (lineTokens.length <= MAX_DIFF_TOKENS) tokens.set(line, lineTokens)
    }

    const taken = new Set<DiffLine>()
    for (const line of deleted) {
        let best: DiffLine | null = null
        let bestResult: { old: TextRange[]; new: TextRange[] } | null = null
        let bestSimilarity = MIN_LINE_SIMILARITY
        for (const candidate of added) {
            if (taken.has(candidate)) continue
            const result = lineSimilarity(line, candidate, tokens.get(line), tokens.get(candidate), bestSimilarity)
            if (result.similarity > bestSimilarity) {
                best = candidate
                bestResult = result
                bestSimilarity = result.similarity
            }
        }
        if (best && bestResult && (bestResult.old.length || bestResult.new.length)) {
            taken.add(best)
            marks.set(line, bestResult.old)
            marks.set(best, bestResult.new)
        }
    }
    return marks
}

export interface HighlightRange {
    start: number
    end: number
    className?: string
}

/** Wraps source ranges in already-highlighted HTML without splitting syntax-token spans or entities. */
export function markHighlightedRanges(html: string, source: string, ranges: HighlightRange[]): string {
    if (!ranges.length || !source.length) return html

    const units: string[] = []
    for (let index = 0; index < html.length; ) {
        if (html[index] === '<') {
            const end = html.indexOf('>', index)
            if (end === -1) return html
            units.push(html.slice(index, end + 1))
            index = end + 1
            continue
        }
        if (html[index] === '&') {
            const entity = /^(?:&amp;|&lt;|&gt;)/.exec(html.slice(index))
            if (entity) {
                units.push(entity[0])
                index += entity[0].length
                continue
            }
        }
        units.push(html[index]!)
        index++
    }

    const afterSourceChar: number[] = [0]
    let visibleLength = 0
    for (let index = 0; index < units.length; index++) {
        if (units[index]!.startsWith('<')) continue
        visibleLength++
        afterSourceChar[visibleLength] = index + 1
    }
    if (visibleLength !== source.length) return html

    const movePastClosingTags = (index: number) => {
        while (index < units.length && units[index]!.startsWith('</')) index++
        return index
    }
    const events = new Map<number, { open: string[]; close: string[] }>()
    const eventAt = (index: number) => {
        const event = events.get(index)
        if (event) return event
        const created = { open: [], close: [] }
        events.set(index, created)
        return created
    }

    for (const range of ranges) {
        const start = Math.max(0, Math.min(range.start, source.length))
        const end = Math.max(start, Math.min(range.end, source.length))
        if (end <= start) continue
        const startAt = movePastClosingTags(afterSourceChar[start] ?? 0)
        const endAt = movePastClosingTags(afterSourceChar[end] ?? units.length)
        const className = range.className ? ` class="${escapeHtml(range.className)}"` : ''
        eventAt(startAt).open.push(`<mark${className}>`)
        eventAt(endAt).close.unshift('</mark>')
    }

    let output = ''
    for (let index = 0; index <= units.length; index++) {
        const event = events.get(index)
        if (event) {
            output += event.close.join('')
            output += event.open.join('')
        }
        if (index < units.length) output += units[index]
    }
    return output
}

export function isWhitespaceOnlyChange(oldText: string, newText: string): boolean {
    const collapse = (text: string) => text.slice(1).replace(/\s+/g, ' ').trim()
    return collapse(oldText) === collapse(newText)
}

export function detectMovedLines(lines: DiffLine[]): Set<DiffLine> {
    const moved = new Set<DiffLine>()
    // Per key: add indexes are pushed in ascending order. `alive` marks entries already matched
    // (the old implementation spliced them out) and `aPtr` is a forward-only cursor over dead
    // entries, so the pathological "thousands of identical lines" case stays near-linear instead
    // of the old O(n²) findIndex+splice.
    const addsByKey = new Map<string, { indexes: number[]; alive: boolean[]; aPtr: number }>()
    lines.forEach((line, index) => {
        if (line.type !== 'add') return
        const key = line.text.slice(1).trimEnd()
        let entry = addsByKey.get(key)
        if (!entry) {
            entry = { indexes: [], alive: [], aPtr: 0 }
            addsByKey.set(key, entry)
        }
        entry.indexes.push(index)
        entry.alive.push(true)
    })
    // Precompute the end of each del+add block in one pass so the matching loop stays O(n).
    const blockEndAt = new Int32Array(lines.length).fill(-1)
    let cursor = 0
    while (cursor < lines.length) {
        if (lines[cursor].type !== 'del') {
            cursor++
            continue
        }
        let blockEnd = cursor
        while (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'del') blockEnd++
        const lastDel = blockEnd
        if (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'add') {
            while (blockEnd + 1 < lines.length && lines[blockEnd + 1].type === 'add') blockEnd++
        }
        for (let d = cursor; d <= lastDel; d++) blockEndAt[d] = blockEnd
        cursor = blockEnd + 1
    }
    lines.forEach((line, index) => {
        if (line.type !== 'del') return
        const blockEnd = blockEndAt[index]
        if (blockEnd === -1) return
        const entry = addsByKey.get(line.text.slice(1).trimEnd())
        if (!entry) return
        const { indexes, alive } = entry
        // Match the first alive add outside this del/add block — same semantics as the old
        // findIndex over the spliced list: the smallest alive index below the block, else the
        // smallest alive index beyond blockEnd.
        let pick = -1
        while (entry.aPtr < indexes.length && !alive[entry.aPtr]) entry.aPtr++
        if (entry.aPtr < indexes.length && indexes[entry.aPtr]! < index) {
            pick = entry.aPtr
        } else {
            // Binary search for the first add index beyond the block, then skip dead entries.
            let lo = 0
            let hi = indexes.length - 1
            let pos = indexes.length
            while (lo <= hi) {
                const mid = (lo + hi) >> 1
                if (indexes[mid]! > blockEnd) {
                    pos = mid
                    hi = mid - 1
                } else {
                    lo = mid + 1
                }
            }
            while (pos < indexes.length && !alive[pos]) pos++
            if (pos < indexes.length) pick = pos
        }
        if (pick === -1) return
        alive[pick] = false
        moved.add(line)
        moved.add(lines[indexes[pick]!]!)
    })
    return moved
}
