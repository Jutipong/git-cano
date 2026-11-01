/**
 * Terminal font-family builders — pure string logic plus a fail-open `document.fonts` probe. No electron imports, so this stays
 * unit-testable (see `tests/unit/terminalFont.test.ts`). Callers live in `TerminalView.vue` (xterm construction + live watch) and
 * `ToolsModal.vue` (preset chips, custom input, not-installed hint).
 */

/**
 * Thai fallback every terminal stack must keep — xterm measures one cell width, and Thai combining marks only land on their column when
 * this chain survives a custom pick. Leelawadee UI is the Windows face, Thonburi the macOS one; a family the platform lacks is skipped.
 */
export const TERMINAL_THAI_FALLBACK = "'Leelawadee UI', 'Thonburi', monospace"

/**
 * Terminal font family the app starts on. Windows: Consolas leads (inbox on every Windows) with Leelawadee UI for the Thai glyphs it
 * lacks. macOS: SF Mono (ships with the OS dev tools), Menlo (always present), Thonburi for Thai.
 */
export function defaultTerminalFontFamily(onMac: boolean): string {
    return onMac ? "'SF Mono', Menlo, 'Thonburi', monospace" : "'Consolas', 'Leelawadee UI', monospace"
}

/** First family of a stack, unquoted and trimmed — the name `document.fonts.check/load` needs. */
export function primaryFontFamily(stack: string): string {
    const first = stack.split(',')[0]?.trim() ?? ''
    return first.replace(/^['"]+|['"]+$/g, '')
}

/**
 * Build the xterm stack for a preset/custom pick. Blank → the default stack; a full stack (contains a comma) is used verbatim; a bare name
 * keeps the Thai fallback.
 */
export function buildTerminalFontFamily(input: string, defaultStack: string): string {
    const name = input.trim()
    if (!name) return defaultStack
    if (name.includes(',')) return name
    return `'${name.replace(/'/g, '')}', ${TERMINAL_THAI_FALLBACK}`
}

/** Texts with mixed advance widths, so a proportional face and a monospace one never measure alike. */
export const FONT_PROBE_TEXTS = ['mmmmmmmmmmww', 'iiiiiiiiii11', '0123456789AaBbCc']

/** Generic families the probe compares against — every platform resolves each one to a real face. */
export const FONT_PROBE_CHAINS = ['monospace', 'serif', 'sans-serif', 'cursive', 'fantasy']

/**
 * True when `family` paints differently from `chain`'s generic face for at least one probe text — i.e. the candidate is real and not just
 * the fallback in disguise. Pure (the measurer is injected) so the metric rule stays unit-testable without a DOM canvas.
 */
export function familyDiffersFromFallback(
    family: string,
    chain: string,
    measure: (font: string, text: string) => number,
    texts: readonly string[] = FONT_PROBE_TEXTS
): boolean {
    return texts.some(text => measure(`12px "${family}", ${chain}`, text) !== measure(`12px ${chain}`, text))
}

/**
 * True when the family is usable here: it differs from **at least one** generic fallback. One chain is not enough — on Windows `monospace`
 * resolves to Consolas, so comparing against it alone reported Consolas itself as missing. (`document.fonts.check()` can't do this job —
 * it reports even a bogus family as available.) Fail-open (no `document`/canvas, or anything throws) so an exotic setup never loses its
 * terminal font — xterm itself falls back silently per glyph.
 */
export function isFontInstalled(family: string): boolean {
    try {
        const doc = (globalThis as unknown as { document?: Document }).document
        const ctx = doc?.createElement('canvas').getContext('2d')
        if (!ctx) return true
        const measure = (font: string, text: string) => {
            ctx.font = font
            return ctx.measureText(text).width
        }
        return FONT_PROBE_CHAINS.some(chain => familyDiffersFromFallback(family, chain, measure))
    } catch {
        return true
    }
}

/** Effective stack: the pick when its primary family exists on this machine, else the default. */
export function resolveTerminalFontFamily(input: string, defaultStack: string): string {
    const built = buildTerminalFontFamily(input, defaultStack)
    return isFontInstalled(primaryFontFamily(built)) ? built : defaultStack
}

/**
 * xterm measures its cell in CSS px, while Electron page zoom carries the UI font scale without changing
 * those metrics. Divide the configured terminal size by that scale so Settings → Terminal's px value stays
 * the terminal's real size when the UI font size changes. The explicit app zoom is deliberately left alone —
 * page zoom still magnifies the whole window.
 */
export function terminalFontPx(size: number, fontScale: number): number {
    return fontScale > 0 ? size / fontScale : size
}
