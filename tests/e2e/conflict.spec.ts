import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.conflictRepo])
    page = handle.page
    await expect(page.locator('.file-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('conflict repo boots with an unmerged file', async () => {
    const status = await page.evaluate(() => (window as unknown as { api: any }).api.status())
    const shared = status.files.find((f: any) => f.path === 'shared.txt')
    expect(shared).toBeTruthy()
    expect(`${shared.staged}${shared.unstaged}`).toContain('U')
})

test('conflict view picks a side, saves and stages the result', async () => {
    await page.locator('.file-row', { hasText: 'shared.txt' }).first().click()
    await expect(page.locator('.conflict-view')).toBeVisible()

    // Pick THEIRS: the main branch already has the "ours" content, so only the incoming side leaves a
    // staged change to assert afterwards.
    await page.locator('.conflict-pane.theirs .pane-head-all .conflict-check').click()
    await expect(page.locator('.conflict-footer .footer-count')).toContainText('1/1 resolved')
    await page.locator('.conflict-footer .footer-save').click()
    await expect(page.locator('.toast').filter({ hasText: 'resolved' })).toBeVisible()
    await expect(page.locator('.conflict-view')).toHaveCount(0)

    await expect
        .poll(() =>
            page.evaluate(async () => {
                const api = (window as unknown as { api: any }).api
                const file = (await api.status()).files.find((f: any) => f.path === 'shared.txt')
                return file ? file.staged : 'gone'
            })
        )
        .toBe('M')
})
