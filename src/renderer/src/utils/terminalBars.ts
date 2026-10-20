/**
 * Terminal block-meter detection — pure string logic so it stays unit-testable (see
 * `tests/unit/terminalBars.test.ts`). The caller lives in `TerminalView.vue` (`markBars`).
 */

/** U+2588 FULL BLOCK — filled meter cells. */
const FULL_BLOCK = '\u2588'
/** U+2591 LIGHT SHADE — the track the sys-status meters draw after the filled cells. */
const LIGHT_SHADE = '\u2591'

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
