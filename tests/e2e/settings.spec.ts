import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

const TABS: { key: string; title: string }[] = [
    { key: 'appearance', title: 'Appearance' },
    { key: 'general', title: 'Refresh' },
    { key: 'auth', title: 'Active SSH key' },
    { key: 'ai', title: 'AI Provider' },
    { key: 'terminal', title: 'Text' },
    { key: 'shortcuts', title: 'Keyboard shortcuts' },
]

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

for (const tab of TABS) {
    test(`settings tab "${tab.key}" shows its panel and first section`, async () => {
        await page.keyboard.press('Control+,')
        await expect(page.locator('.tools-modal')).toBeVisible()

        await page.locator(`#settings-tab-${tab.key}`).click()
        await expect(page.locator('#settings-panel')).toHaveAttribute('aria-labelledby', `settings-tab-${tab.key}`)
        await expect(page.locator('#settings-panel .tools-section-title', { hasText: tab.title }).first()).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.locator('.tools-modal')).toHaveCount(0)
    })
}

test('an unsaved AI token survives a trip to another tab', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('#settings-tab-ai').click()
    const token = page.locator('input[placeholder="opencode token"]')
    await expect(token).toBeVisible()
    await token.fill('draft-token')

    await page.locator('#settings-tab-terminal').click()
    await page.locator('#settings-tab-ai').click()
    await expect(page.locator('input[placeholder="opencode token"]')).toHaveValue('draft-token')

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

// Tabs that stay mounted (v-show) must not leak their content into the other tabs.
test('a visited Remotes or AI tab stays hidden on every other tab', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('#settings-tab-auth').click()
    const sshTitle = page.locator('#settings-panel .tools-section-title', { hasText: 'Active SSH key' })
    await expect(sshTitle).toBeVisible()

    await page.locator('#settings-tab-shortcuts').click()
    await expect(page.locator('#settings-panel .tools-section-title', { hasText: 'Keyboard shortcuts' })).toBeVisible()
    await expect(sshTitle).toBeHidden()

    await page.locator('#settings-tab-ai').click()
    const aiTitle = page.locator('#settings-panel .tools-section-title', { hasText: 'AI Provider' })
    await expect(aiTitle).toBeVisible()
    await expect(sshTitle).toBeHidden()

    await page.locator('#settings-tab-shortcuts').click()
    await expect(aiTitle).toBeHidden()

    await page.locator('#settings-tab-auth').click()
    await expect(sshTitle).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})
