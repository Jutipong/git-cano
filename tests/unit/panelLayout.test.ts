import { describe, expect, it } from 'vitest'

import {
    CENTER_MIN_WIDTH,
    PANEL_CHROME_WIDTH,
    RIGHT_PANEL_MAX_WIDTH,
    RIGHT_PANEL_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
    SIDEBAR_MIN_WIDTH,
    computePanelWidths,
} from '../../src/renderer/src/utils/panelLayout'

describe('computePanelWidths', () => {
    it('keeps the preferred widths when all three columns fit', () => {
        expect(computePanelWidths(1400, 280, 360)).toEqual({ sidebar: 280, right: 360 })
    })

    it('shrinks both panels proportionally at the minimum window width', () => {
        const width = 1000
        const { sidebar, right } = computePanelWidths(width, 280, 360)
        expect(sidebar).toBeLessThan(280)
        expect(right).toBeLessThan(360)
        expect(sidebar).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH)
        expect(right).toBeGreaterThanOrEqual(RIGHT_PANEL_MIN_WIDTH)
        expect(sidebar + right + CENTER_MIN_WIDTH).toBeLessThanOrEqual(width - PANEL_CHROME_WIDTH)
    })

    it('gives the panels their maximum slack before the center reaches its floor', () => {
        const width = 1000
        const { sidebar, right } = computePanelWidths(width, SIDEBAR_MAX_WIDTH, RIGHT_PANEL_MAX_WIDTH)
        expect(sidebar + right + CENTER_MIN_WIDTH).toBeLessThanOrEqual(width - PANEL_CHROME_WIDTH)
        expect(sidebar).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH)
        expect(right).toBeGreaterThanOrEqual(RIGHT_PANEL_MIN_WIDTH)
    })

    it('clamps preferred widths to the drag bounds', () => {
        expect(computePanelWidths(1400, 100, 900)).toEqual({ sidebar: SIDEBAR_MIN_WIDTH, right: RIGHT_PANEL_MAX_WIDTH })
    })

    it('falls back to the floors when even the floors do not fit', () => {
        expect(computePanelWidths(800, 280, 360)).toEqual({ sidebar: SIDEBAR_MIN_WIDTH, right: RIGHT_PANEL_MIN_WIDTH })
    })
})
