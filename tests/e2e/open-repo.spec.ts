import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { launchApp, type AppHandle } from './launch'

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page
let folder: string

test.beforeAll(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cano-e2e-newrepo-'))
    fs.writeFileSync(path.join(folder, 'README.md'), '# New project\n')
    handle = await launchApp([])
    page = handle.page
    // Replace the native picker for this spec: every open request lands on the unversioned folder.
    await handle.app.evaluate(({ dialog }, target) => {
        const picker = dialog as unknown as { showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }> }
        picker.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] })
    }, folder)
})

test.afterAll(async () => {
    await handle?.app.close()
    if (folder) fs.rmSync(folder, { recursive: true, force: true })
})

test('opening a folder without .git asks before initializing (cancel keeps it untouched)', async () => {
    await page.keyboard.press('Control+o')

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#confirm-dialog-title')).toHaveText('Initialize repository?')
    await expect(dialog.locator('#confirm-dialog-message')).toContainText(folder)

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.repo-tab')).toHaveCount(0)
    expect(fs.existsSync(path.join(folder, '.git'))).toBe(false)
})

test('initialize creates the repository and opens it', async () => {
    await page.keyboard.press('Control+o')

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Initialize' }).click()

    await expect(page.locator('.repo-tab')).toHaveCount(1)
    await expect(page.locator('.repo-tab-name')).toHaveText(path.basename(folder))
    await expect.poll(() => fs.existsSync(path.join(folder, '.git'))).toBe(true)
    await expect(page.locator('.graph-empty')).toContainText('No commits')
    await expect(page.locator('.file-row', { hasText: 'README.md' })).toBeVisible()
})
