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

    // Right-click menus must escape the panel's clip-path reveal: the card clips its subtree, so a
    // fixed menu left inside it was cut off at the panel's right edge.
    const branchRow = sidebar.locator('.branch-row').first()
    const rowBox = await branchRow.boundingBox()
    await branchRow.click({ button: 'right', position: { x: rowBox!.width - 10, y: 12 } })
    const branchMenu = page.locator('.local-branch-menu')
    await expect(branchMenu).toBeVisible()
    const menuBox = (await branchMenu.boundingBox())!
    const panelBox = (await sidebar.boundingBox())!
    expect(menuBox.width).toBeGreaterThanOrEqual(190)
    expect(menuBox.x + menuBox.width).toBeGreaterThan(panelBox.x + panelBox.width)
    // Teleported to <body>, so no sidebar clip applies to it.
    expect(await branchMenu.evaluate(el => el.parentElement === document.body)).toBe(true)
    // Hit-testing honours clip-path: a point past the panel edge still belongs to the menu.
    const overMenu = await page.evaluate(
        ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.local-branch-menu'),
        { x: panelBox.x + panelBox.width + 10, y: menuBox.y + 12 }
    )
    expect(overMenu).toBe(true)
    await page.keyboard.press('Escape')
    await expect(branchMenu).toHaveCount(0)
    await expect(sidebar).toBeVisible()
    // Park the pointer outside the panel again so the later rail hover re-enters it.
    await page.mouse.move(900, 300)

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
