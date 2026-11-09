import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
    await page.locator('.splash-screen').waitFor({ state: 'detached' })
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('mini sidebar collapses to a rail and opens as one card on hover', async () => {
    // Full mode: the sidebar toolbar button is the discoverable way in.
    await page.locator('.sidebar-mini-btn').click()

    const rail = page.locator('.sidebar-rail')
    await expect(rail).toBeVisible()
    const sidebar = page.locator('.sidebar-host > .sidebar')
    await expect(sidebar).toBeHidden()
    await expect(page.locator('.panel-splitter[aria-label="Resize sidebar"]')).toHaveCount(0)
    await expect(page.locator('.graph-scroll')).toBeVisible()

    // Hover previews the sidebar over the rail's own slot without moving the graph.
    const graphBoxBefore = await page.locator('.graph-scroll').boundingBox()
    const railBox = await rail.boundingBox()
    // The mini rail keeps the splitter's gutter instead of sitting flush against the graph card.
    const centerBox = await page.locator('.center-column').boundingBox()
    expect(centerBox!.x - (railBox!.x + railBox!.width)).toBeGreaterThanOrEqual(5)
    await rail.hover()
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())?.x).toBe(railBox?.x)
    expect((await page.locator('.graph-scroll').boundingBox())?.x).toBe(graphBoxBefore?.x)

    // Leaving collapses it again (hover-only, like the collapsed-menu layout).
    await page.mouse.move(900, 300)
    await expect(sidebar).toBeHidden()

    // Keyboard activation on a rail icon pins the panel to that section, so it survives the pointer leaving.
    const localButton = rail.getByRole('button', { name: 'Local branches' })
    await localButton.focus()
    await page.keyboard.press('Enter')
    await expect(sidebar).toBeVisible()
    await page.mouse.move(900, 300)
    await expect(sidebar).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(sidebar).toBeHidden()

    // The panel's toolbar button flips to Expand and returns to the full sidebar.
    await rail.hover()
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(rail).toHaveCount(0)
    await expect(page.locator('.panel-splitter[aria-label="Resize sidebar"]')).toBeVisible()

    // The command palette carries the same toggle.
    await page.locator('.graph-scroll').focus()
    await page.keyboard.press('Control+P')
    await page.locator('.palette-input').fill('mini')
    await page.locator('.palette-item', { hasText: 'Sidebar: collapse to mini' }).click()
    await expect(rail).toBeVisible()

    await page.locator('.graph-scroll').focus()
    await page.keyboard.press('Control+B')
    await expect(rail).toHaveCount(0)
})
