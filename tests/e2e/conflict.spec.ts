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

test('both-added file is reported as unmerged, not staged', async () => {
    const status = await page.evaluate(() => (window as unknown as { api: any }).api.status())
    const both = status.files.find((f: any) => f.path === 'both-added.txt')
    expect(both).toBeTruthy()
    expect(`${both.staged}${both.unstaged}`).toBe('AA')
})

test('both-added conflict is listed and resolvable', async () => {
    // shared.txt was resolved above, so two conflicts remain: both-added.txt and mixed-conflict.txt.
    await expect(page.locator('.conflict-continue')).toBeDisabled()
    await expect(page.locator('.group-header', { hasText: 'Conflicted files' })).toContainText('2')

    const row = page.locator('.file-row', { hasText: 'both-added.txt' })
    await expect(row.locator('.badge.b-u')).toBeVisible()
    await row.locator('button[title^="Mark this file as resolved"]').click()

    await expect(page.locator('.toast').filter({ hasText: 'both-added.txt: resolved' })).toBeVisible()
    await expect(page.locator('.group-header', { hasText: 'Conflicted files' })).toContainText('1')
    await expect(page.locator('.group-header', { hasText: 'Resolved files' })).toContainText('2')
    await expect(page.locator('.conflict-continue')).toBeDisabled()

    await expect
        .poll(() =>
            page.evaluate(async () => {
                const api = (window as unknown as { api: any }).api
                const file = (await api.status()).files.find((f: any) => f.path === 'both-added.txt')
                return file ? `${file.staged}${file.unstaged}` : 'gone'
            })
        )
        .toBe('M ')
})

test('whole-side pick resolves a conflict whose chosen side is empty', async () => {
    // mixed-conflict.txt has two blocks; the incoming side deleted the first one, so it has no lines to tick.
    await page.locator('.file-row', { hasText: 'mixed-conflict.txt' }).first().click()
    await expect(page.locator('.conflict-view')).toBeVisible()

    await page.locator('.conflict-pane.theirs .pane-head-all .conflict-check').click()
    // Regression: the empty side used to stay unresolved, leaving the footer at 1/2 with Save disabled.
    await expect(page.locator('.conflict-footer .footer-count')).toContainText('2/2 resolved')
    await expect(page.locator('.conflict-footer .footer-save')).toBeEnabled()

    await page.locator('.conflict-footer .footer-save').click()
    await expect(page.locator('.toast').filter({ hasText: 'conflicts resolved' })).toBeVisible()
    await expect(page.locator('.conflict-view')).toHaveCount(0)
    await expect(page.locator('.group-header', { hasText: 'Conflicted files' })).toHaveCount(0)
    await expect(page.locator('.group-header', { hasText: 'Resolved files' })).toContainText('3')
    await expect(page.locator('.conflict-continue')).toBeEnabled()

    await expect
        .poll(() =>
            page.evaluate(async () => {
                const api = (window as unknown as { api: any }).api
                const file = (await api.status()).files.find((f: any) => f.path === 'mixed-conflict.txt')
                return file ? `${file.staged}${file.unstaged}` : 'gone'
            })
        )
        .toBe('M ')
})
