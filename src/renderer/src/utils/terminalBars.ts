/**
 * Terminal bar/rule detection — pure string logic so it stays unit-testable (see
 * `tests/unit/terminalBars.test.ts`). The caller lives in `TerminalView.vue` (`markBars`).
 */

/** U+2588 FULL BLOCK — filled meter cells. */
const FULL_BLOCK = '\u2588'
/** U+2591 LIGHT SHADE — the track the sys-status meters draw after the filled cells. */
const LIGHT_SHADE = '\u2591'
/** U+2502 / U+2503 BOX DRAWINGS LIGHT / HEAVY VERTICAL — the solid rails a TUI stacks per row. */
const LIGHT_VERTICAL = '\u2502'
const HEAVY_VERTICAL = '\u2503'
/** U+2575 / U+2579 (up) and U+2577 / U+257B (down): the half-cell caps a rail ends on (`╹` = heavy up). */
const LIGHT_UP = '\u2575'
const HEAVY_UP = '\u2579'
const LIGHT_DOWN = '\u2577'
const HEAVY_DOWN = '\u257b'
/** Trailing blanks are inside the same SGR run whenever a TUI pads its gutter (`┃   ` on a blank line). */
const LIGHT_VERTICAL_RUN = new RegExp(`^(${LIGHT_VERTICAL}+) *$`)
const HEAVY_VERTICAL_RUN = new RegExp(`^(${HEAVY_VERTICAL}+) *$`)
const LIGHT_UP_CAP = new RegExp(`^${LIGHT_UP} *$`)
const HEAVY_UP_CAP = new RegExp(`^${HEAVY_UP} *$`)
const LIGHT_DOWN_CAP = new RegExp(`^${LIGHT_DOWN} *$`)
const HEAVY_DOWN_CAP = new RegExp(`^${HEAVY_DOWN} *$`)

const METER_RUN = new RegExp(`^(${FULL_BLOCK}+)${LIGHT_SHADE}*$`)

/**
 * Cells covered by a leading run of `█` when the span is exactly a meter: filled blocks followed by
 * an optional `░` track (`████░░░`). Returns 0 for anything else — a scrollbar cell, the wordmark,
 * Thai text — so the caller never paints over arbitrary content.
 */
export function fullBlockCells(text: string): number {
    const match = METER_RUN.exec(text)
    return match ? match[1].length : 0
}

/** Stroke weight of a vertical box-drawing run — picks the stripe width in `modern-ui.css`. */
export type VerticalRuleKind = 'light' | 'heavy'

/** How much of the cell the rule fills: a rail cell, or the half-cell cap a rail ends on. */
export type VerticalRulePart = 'full' | 'top' | 'bottom'

/** A solid vertical rule: its stroke weight, which part of the cell it fills, and its cell count. */
export interface VerticalRuleRun {
    kind: VerticalRuleKind
    part: VerticalRulePart
    cells: number
}

/**
 * The solid vertical rule a span starts with (`│`/`┃` runs or the `╵ ╹ ╷ ╻` end caps, optionally
 * padded with blanks), else null. `cells` counts only the rule cells, so a padded gutter (`┃   `) is
 * not painted over.
 *
 * Only the solid verticals and their half-cell caps qualify: the dashed variants (`┆ ┇ ┊ ┋ ╎ ╏`) are
 * dashed on purpose and the double ones (`║`) have two strokes, so painting a solid centred stripe
 * over their cells would erase the shape they are meant to draw. A rule that follows other text never
 * matches — the stripe would land on the wrong cell.
 */
export function verticalRuleRun(text: string): VerticalRuleRun | null {
    const light = LIGHT_VERTICAL_RUN.exec(text)
    if (light) return { kind: 'light', part: 'full', cells: light[1].length }
    const heavy = HEAVY_VERTICAL_RUN.exec(text)
    if (heavy) return { kind: 'heavy', part: 'full', cells: heavy[1].length }
    if (LIGHT_UP_CAP.test(text)) return { kind: 'light', part: 'top', cells: 1 }
    if (HEAVY_UP_CAP.test(text)) return { kind: 'heavy', part: 'top', cells: 1 }
    if (LIGHT_DOWN_CAP.test(text)) return { kind: 'light', part: 'bottom', cells: 1 }
    if (HEAVY_DOWN_CAP.test(text)) return { kind: 'heavy', part: 'bottom', cells: 1 }
    return null
}
