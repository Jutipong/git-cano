import { expect, test, type Locator, type Page } from '@playwright/test'

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

/** Rendered height in CSS px — read from the computed style so the window's zoom cannot skew the number. */
async function height(locator: Locator): Promise<number> {
    await expect(locator).toBeVisible()
    return locator.evaluate(el => parseFloat(getComputedStyle(el).height))
}

function token(name: string): Promise<number> {
    return page.evaluate(n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name)
}

test('control-height tokens are the compact 24 / 28 / 32 scale', async () => {
    expect(await token('--control-h-sm')).toBe(24)
    expect(await token('--control-h-md')).toBe(28)
    expect(await token('--control-h-lg')).toBe(32)
})

test('main-screen controls follow the tokens', async () => {
    // Row actions (Stage / Discard) only show on hover.
    const row = page.locator('.file-row', { hasText: 'untracked-big.txt' }).first()
    await row.hover()
    expect(await height(row.locator('.icon-btn').first())).toBe(24)
    expect(await height(page.locator('.commit-search'))).toBe(28)
    expect(await height(page.locator('.sidebar-bottom-actions .toolbar-icon-button').first())).toBe(28)
    expect(await height(page.locator('.tab-actions .tab-new'))).toBe(32)
})

test('diff header pills line up on the sm scale', async () => {
    await page.locator('.file-row', { hasText: 'untracked-big.txt' }).first().click()
    await expect(page.locator('.diff-header strong')).toHaveText('untracked-big.txt')
    expect(await height(page.locator('.diff-header .segmented-btn').first())).toBe(24)
    expect(await height(page.locator('.diff-header .segmented').first())).toBe(30)
    expect(await height(page.locator('.diff-search-input'))).toBe(24)
    await page.keyboard.press('Escape')
    await expect(page.locator('.diff-view')).toHaveCount(0)
})

test('create-branch prompt input and buttons are md', async () => {
    await page.locator('.branch-row').first().click({ button: 'right' })
    await page.locator('.local-branch-menu-item', { hasText: 'Create branch' }).click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    expect(await height(page.locator('.prompt-input'))).toBe(28)
    expect(await height(page.locator('.confirm-dialog-actions .btn').first())).toBe(28)
    await page.keyboard.press('Escape')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
})

test('settings fields are lg, chips md and dense buttons sm', async () => {
    await page.keyboard.press('Control+,')
    await expect(page.locator('.tools-modal')).toBeVisible()
    expect(await height(page.locator('.tools-modal .setting-chip').first())).toBe(28)
    await page.locator('#settings-tab-terminal').click()
    expect(await height(page.locator('.tools-body input[type="text"]').first())).toBe(32)
    await page.locator('#settings-tab-shortcuts').click()
    expect(await height(page.locator('.tools-modal .btn.small').first())).toBe(24)
    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})
