import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo, fx.opsRepo])
    page = handle.page
    await expect(page.locator('.repo-tab')).toHaveCount(2)
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('workspace create + switch away and back restores the tabs', async () => {
    await page.locator('.workspace-btn').click()
    await page.locator('.workspace-add').click()
    await page.locator('.workspace-add-input').fill('Alt')
    // Confirm-and-switch: creating a workspace moves to it immediately and closes the popover.
    await page.locator('.workspace-add-form button', { hasText: 'Add' }).click()
    await expect(page.locator('.repo-tab')).toHaveCount(0)
    await expect(page.locator('.app-empty')).toBeVisible()

    // The empty workspace still offers the switcher — use it to get back to Main.
    await page.locator('.app-empty .workspace-btn').click()
    await page.locator('.workspace-pop .workspace-item', { hasText: 'Main' }).click()
    await expect(page.locator('.repo-tab')).toHaveCount(2)
    await expect(page.locator('.graph-row').first()).toBeVisible()
})
