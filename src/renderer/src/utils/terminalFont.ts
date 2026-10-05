/**
 * Terminal font-family builders — pure string logic plus a fail-open `document.fonts` probe.
 * No electron imports, so this stays unit-testable (see `tests/unit/terminalFont.test.ts`).
 * Callers live in `TerminalView.vue` (xterm construction + live watch) and `ToolsModal.vue`
 * (preset chips, custom input, not-installed hint).
 */

/** Thai fallback every terminal stack must keep — xterm measures one cell width, and Thai
 *  combining marks only land on their column when this chain survives a custom pick. */
export const TERMINAL_THAI_FALLBACK = "'Leelawadee UI', monospace"

/** First family of a stack, unquoted and trimmed — the name `document.fonts.check/load` needs. */
export function primaryFontFamily(stack: string): string {
    const first = stack.split(',')[0]?.trim() ?? ''
    return first.replace(/^['"]+|['"]+$/g, '')
}

/**
 * Build the xterm stack for a preset/custom pick. Blank → the default stack; a full stack
 * (contains a comma) is used verbatim; a bare name keeps the Thai fallback.
 */
export function buildTerminalFontFamily(input: string, defaultStack: string): string {
    const name = input.trim()
    if (!name) return defaultStack
    if (name.includes(',')) return name
    return `'${name.replace(/'/g, '')}', ${TERMINAL_THAI_FALLBACK}`
}

/**
 * True when the family is usable here. Compares canvas widths of the candidate against the plain
 * `monospace` fallback: a missing face renders with the fallback metrics, so identical widths mean
 * "not installed". (`document.fonts.check()` can't do this job — it reports even a bogus family as
 * available.) Fail-open (no `document`/canvas, or anything throws) so an exotic setup never loses
 * its terminal font — xterm itself falls back silently per glyph.
 */
const FONT_PROBE_TEXTS = ['mmmmmmmmmmww', 'iiiiiiiiii11', '0123456789AaBbCc']

export function isFontInstalled(family: string): boolean {
    try {
        const doc = (globalThis as unknown as { document?: Document }).document
        const ctx = doc?.createElement('canvas').getContext('2d')
        if (!ctx) return true
        return FONT_PROBE_TEXTS.some(text => {
            ctx.font = '12px monospace'
            const fallback = ctx.measureText(text).width
            ctx.font = `12px "${family}", monospace`
            return ctx.measureText(text).width !== fallback
        })
    } catch {
        return true
    }
}

/** Effective stack: the pick when its primary family exists on this machine, else the default. */
export function resolveTerminalFontFamily(input: string, defaultStack: string): string {
    const built = buildTerminalFontFamily(input, defaultStack)
    return isFontInstalled(primaryFontFamily(built)) ? built : defaultStack
}
