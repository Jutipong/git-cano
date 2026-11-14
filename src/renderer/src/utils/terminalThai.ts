/**
 * Thai cell joins for xterm's DOM renderer. Pure string logic, so it stays unit-testable (see `tests/unit/terminalThai.test.ts`);
 * the caller is `registerCharacterJoiner()` in `TerminalView.vue`.
 *
 * SARA AM (U+0E33) is the one Thai character xterm reserves a cell for: the tone marks and the above/below vowels are zero width,
 * so xterm folds them into the consonant's own cell, while SARA AM measures one column and lands in a cell of its own. A cell of
 * its own means the mark is shaped alone, and the macOS Thai faces (Thonburi — the macOS default stack — plus Krungthep, Sathu,
 * Silom, Sukhumvit Set) draw a lone SARA AM as a dotted-circle cluster one column to the right of its consonant, i.e. the
 * "floating" marks. Consolas + Leelawadee UI on Windows hide this because the Windows face draws a lone SARA AM as a full-width
 * glyph, but the cell split happens on every platform.
 *
 * Joining the cluster's cells back into one render unit lets the browser shape `จำ` as one run. The grid keeps both columns, so
 * the shell's wcwidth (SARA AM = 1) and the terminal still agree — unlike a zero-width SARA AM, which would leave every cursor
 * move one column off.
 */

const SARA_AM = 0x0e33

/** Zero-width Thai marks, i.e. the ones xterm already folds into the previous cell. */
function isThaiMark(cp: number): boolean {
    return cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e)
}

/**
 * Cell ranges (`[start, end)` in the row's string) a character joiner has to merge: each SARA AM together with the consonant
 * cluster it belongs to. A lone SARA AM (after a space, or at the start of the line) and non-Thai text yield nothing.
 */
export function thaiClusterJoins(text: string): [number, number][] {
    const ranges: [number, number][] = []
    for (let i = 1; i < text.length; i++) {
        if (text.charCodeAt(i) !== SARA_AM) continue
        // A tone mark typed before the SARA AM (`น้ำ`) sits inside the consonant's own cell, and a range that starts on a mark
        // has no cell to anchor to — xterm maps string indexes to columns and would start one cell too late. Walk back to the
        // first character of the cluster instead.
        let start = i - 1
        while (start > 0 && isThaiMark(text.charCodeAt(start))) start -= 1
        const base = text.charCodeAt(start)
        // Only a Thai consonant carries a SARA AM — never join the cell before a space or a Latin character.
        if (base < 0x0e01 || base > 0x0e2e) continue
        ranges.push([start, i + 1])
    }
    return ranges
}
