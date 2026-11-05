/** Width floors/maxima shared by the splitters, the stores' clamps and the CSS. */
export const SIDEBAR_MIN_WIDTH = 250
export const SIDEBAR_MAX_WIDTH = 380
export const RIGHT_PANEL_MIN_WIDTH = 330
export const RIGHT_PANEL_MAX_WIDTH = 500
/** The center column never gives up more than this before the side panels start shrinking. */
export const CENTER_MIN_WIDTH = 380
/**
 * Horizontal space `.app` spends outside the three columns: its 6px padding on both sides plus the
 * two `.panel-splitter`s (5px wide with -2px margins, so 1px of layout each).
 */
export const PANEL_CHROME_WIDTH = 14

export interface PanelWidths {
    sidebar: number
    right: number
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/**
 * Effective sidebar/Changes widths for the current window. The preferred widths are the user's
 * persisted drag positions; when the center column would drop below `CENTER_MIN_WIDTH`, the side
 * panels give up their slack above their floors proportionally. Below the floors (very high app
 * zoom) both sit at their minimum and the center keeps whatever is left.
 */
export function computePanelWidths(viewportWidth: number, sidebarPreferred: number, rightPreferred: number): PanelWidths {
    const sidebar = clamp(Math.round(sidebarPreferred), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    const right = clamp(Math.round(rightPreferred), RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH)
    const available = viewportWidth - PANEL_CHROME_WIDTH
    const overflow = sidebar + right + CENTER_MIN_WIDTH - available
    if (overflow <= 0) return { sidebar, right }

    const sidebarSlack = sidebar - SIDEBAR_MIN_WIDTH
    const rightSlack = right - RIGHT_PANEL_MIN_WIDTH
    const slack = sidebarSlack + rightSlack
    if (slack <= 0) return { sidebar, right }
    if (overflow >= slack) return { sidebar: SIDEBAR_MIN_WIDTH, right: RIGHT_PANEL_MIN_WIDTH }

    // Ceil the first share so the pair always gives up the full overflow (no 1px residual).
    const sidebarGive = Math.min(sidebarSlack, Math.ceil((overflow * sidebarSlack) / slack))
    const rightGive = Math.min(rightSlack, overflow - sidebarGive)
    return { sidebar: sidebar - sidebarGive, right: right - rightGive }
}
