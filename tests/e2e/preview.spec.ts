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
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('markdown preview renders sanitized content', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click()
    await expect(page.locator('.diff-preview-btn')).toBeVisible()
    await page.locator('.diff-preview-btn').click()
    await expect(page.locator('.preview-view')).toBeVisible()
    await expect(page.locator('.md-preview')).toContainText('Rendered')
    await expect(page.locator('.md-preview strong')).toContainText('markdown')
    await page.locator('.preview-view .diff-close-btn').click()
    await expect(page.locator('.preview-view')).toHaveCount(0)
})

test('json preview pretty-prints with token colors', async () => {
    await page.locator('.file-row', { hasText: 'data.json' }).first().click()
    await expect(page.locator('.diff-preview-btn')).toBeVisible()
    await page.locator('.diff-preview-btn').click()
    await expect(page.locator('.json-preview')).toContainText('"version": 2')
    await expect(page.locator('.json-preview .jk').first()).toBeVisible()
    await page.locator('.preview-view .diff-close-btn').click()
})

test('file history modal opens from the file context menu', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click({ button: 'right' })
    await expect(page.locator('.file-context-menu')).toBeVisible()
    await page.locator('.file-context-menu-item', { hasText: 'View history' }).click()
    await expect(page.locator('.history-view')).toBeVisible()
    await expect(page.locator('.history-row').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.history-view')).toHaveCount(0)
})

test('reflog modal opens from the command palette', async () => {
    await page.keyboard.press('Control+p')
    await expect(page.locator('.palette')).toBeVisible()
    await page.locator('.palette-input').fill('reflog')
    await page.locator('.palette-item', { hasText: 'Reflog' }).click()
    await expect(page.locator('.reflog-row').first()).toBeVisible()
    await page.locator('.reflog-modal .commit-close-btn').click()
    await expect(page.locator('.reflog-row')).toHaveCount(0)
})
