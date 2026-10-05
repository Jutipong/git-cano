import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo, fx.opsRepo], { workspaces: { Alt: [fx.extraRepos[0]] } })
    page = handle.page
    await expect(page.locator('.repo-tab')).toHaveCount(2)
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('outer search finds repos without entering Repo… mode', async () => {
    await page.keyboard.press('Control+p')
    await expect(page.locator('.palette')).toBeVisible()
    await page.locator('.palette-input').fill('ops')

    // No drill-in needed: the Repositories section appears at the outermost level.
    await expect(page.locator('.palette-section-header', { hasText: 'Repositories' })).toBeVisible()
    const hit = page.locator('.palette-item', { hasText: 'ops-repo' })
    await expect(hit).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page.locator('.palette')).toBeHidden()
    await expect(page.locator('.repo-tab.active')).toContainText('ops-repo')
})

test('Open in… drills into a target list and escapes back', async () => {
    await page.keyboard.press('Control+p')
    await page.locator('.palette-item', { hasText: 'Open in…' }).click()

    await expect(page.locator('.palette-chip', { hasText: 'Open in' })).toBeVisible()
    await expect(page.locator('.palette-item', { hasText: 'Open in: Folder' })).toBeVisible()
    await expect(page.locator('.palette-item', { hasText: 'Open in: Terminal' })).toBeVisible()
    await expect(page.locator('.palette-item', { hasText: 'Open in: VS Code' })).toBeVisible()

    // Esc backs out to commands instead of closing — nothing was launched.
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette-chip')).toBeHidden()
    await expect(page.locator('.palette-item', { hasText: 'Pull' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette')).toBeHidden()
})

test('outer search finds branches and checks out the picked one', async () => {
    // ops-repo is the clean fixture — make sure it is active, create the branch there, then
    // reswitch tabs so the branch list loads fresh (the store cannot know about the api-side creation).
    await page.locator('.repo-tab', { hasText: 'ops-repo' }).click()
    await expect(page.locator('.repo-tab.active')).toContainText('ops-repo')
    await page.evaluate(() => (window as unknown as { api: any }).api.createBranch('feature-palette', false))
    await page.locator('.repo-tab', { hasText: 'main-repo' }).click()
    await expect(page.locator('.repo-tab.active')).toContainText('main-repo')
    await page.locator('.repo-tab', { hasText: 'ops-repo' }).click()
    await expect(page.locator('.repo-tab.active')).toContainText('ops-repo')
    await expect(page.locator('.graph-row').first()).toBeVisible()

    await page.keyboard.press('Control+p')
    await page.locator('.palette-input').fill('feature-palette')

    await expect(page.locator('.palette-section-header', { hasText: 'Branches' })).toBeVisible()
    await page.locator('.palette-item', { hasText: 'feature-palette' }).click()

    await expect(page.locator('.palette')).toBeHidden()
    await expect(page.locator('.toast', { hasText: 'Checked out feature-palette' })).toBeVisible()
    const current = await page.evaluate(() =>
        (window as unknown as { api: any }).api.branches().then((b: any) => b.local.find((x: any) => x.current)?.name)
    )
    expect(current).toBe('feature-palette')
})

test('outer search finds workspaces and switches to the picked one', async () => {
    await page.keyboard.press('Control+p')
    await page.locator('.palette-input').fill('alt')

    await expect(page.locator('.palette-section-header', { hasText: 'Workspaces' })).toBeVisible()
    await page.locator('.palette-item', { hasText: 'Alt' }).first().click()

    await expect(page.locator('.palette')).toBeHidden()
    await expect(page.locator('.workspace-btn-name')).toHaveText('Alt')
    await expect(page.locator('.repo-tab')).toHaveCount(1)
    await expect(page.locator('.repo-tab.active')).toContainText('extra-1')
})
