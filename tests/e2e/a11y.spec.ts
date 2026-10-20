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

test('error dialog traps focus and restores it on escape', async () => {
    const push = page.locator('.tab-sync-actions button[title^="Push"]')
    await push.focus()
    await page.keyboard.press('Enter')

    const dialog = page.locator('.error-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('role', 'alertdialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'error-dialog-title')
    await expect(page.locator('#error-dialog-title')).toHaveText('Error')

    const closeBtn = page.locator('.error-dialog-actions .btn.primary')
    const closeX = page.locator('.error-dialog .commit-close-btn')
    await expect(closeBtn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(closeX).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(closeBtn).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(push).toBeFocused()
})

test('confirm dialog is modal, traps tab and keeps the settings modal open', async () => {
    await page.keyboard.press('Control+,')
    const settings = page.locator('.tools-modal')
    await expect(settings).toBeVisible()
    await expect(settings).toHaveAttribute('role', 'dialog')
    await expect(settings).toHaveAttribute('aria-modal', 'true')
    await expect(settings).toHaveAttribute('aria-labelledby', 'tools-modal-title')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Shortcuts' }).click()

    const defaultBtn = page.getByRole('button', { name: 'Default', exact: true })
    await defaultBtn.focus()
    await page.keyboard.press('Enter')

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title')
    await expect(page.locator('#confirm-dialog-title')).toHaveText('Confirm')

    const cancel = page.locator('.confirm-dialog-actions .btn').first()
    const confirm = page.locator('.confirm-dialog-actions .btn.danger')
    await expect(confirm).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(cancel).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(confirm).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(settings).toBeVisible()
    await expect(defaultBtn).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
})

test('enter on a confirm cancel button cancels instead of confirming', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Shortcuts' }).click()

    const defaultBtn = page.getByRole('button', { name: 'Default', exact: true })
    await defaultBtn.focus()
    await page.keyboard.press('Enter')

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toBeVisible()
    const cancel = page.locator('.confirm-dialog-actions .btn').first()
    await cancel.focus()
    await page.keyboard.press('Enter')

    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.toast-message', { hasText: 'Shortcuts reset to defaults' })).toHaveCount(0)
    await expect(page.locator('.tools-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('settings dialog is modal and traps tab', async () => {
    await page.keyboard.press('Control+,')
    const settings = page.locator('.tools-modal')
    await expect(settings).toBeVisible()
    await expect(settings).toHaveAttribute('role', 'dialog')
    await expect(settings).toHaveAttribute('aria-modal', 'true')
    await expect(settings).toHaveAttribute('aria-labelledby', 'tools-modal-title')
    await expect(page.locator('#tools-modal-title')).toContainText('Settings')
    await expect(page.locator('.tools-modal .commit-close-btn')).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.tools-modal'))).toBe(true)
    await page.keyboard.press('Tab')
    await expect(page.locator('.tools-modal .commit-close-btn')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('settings choice groups expose labels and pressed state', async () => {
    await page.keyboard.press('Control+,')
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('group', { name: 'Font size' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('shortcuts dialog stacks over settings and closes only itself', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Shortcuts' }).click()

    const shortcutsBtn = page.getByRole('button', { name: 'Keyboard shortcuts…' })
    await shortcutsBtn.focus()
    await page.keyboard.press('Enter')

    const shortcuts = page.locator('.shortcuts-modal')
    await expect(shortcuts).toHaveAttribute('role', 'dialog')
    await expect(shortcuts).toHaveAttribute('aria-modal', 'true')
    await expect(shortcuts).toHaveAttribute('aria-labelledby', 'shortcuts-modal-title')
    await expect(page.locator('.shortcuts-modal :focus')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(shortcuts).toHaveCount(0)
    await expect(page.locator('.tools-modal')).toBeVisible()
    await expect(shortcutsBtn).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('command palette is modal, backs out of drill-in and restores focus', async () => {
    const trigger = page.locator('.tab-sync-actions button[title^="Push"]')
    await trigger.focus()
    await page.keyboard.press('Control+p')

    const palette = page.locator('.palette')
    await expect(palette).toHaveAttribute('role', 'dialog')
    await expect(palette).toHaveAttribute('aria-modal', 'true')
    const input = page.locator('.palette-input')
    await expect(input).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.palette'))).toBe(true)

    await input.fill('repo')
    await page.locator('.palette-item', { hasText: 'Repo…' }).first().click()
    await expect(page.locator('.palette-chip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.palette-chip')).toHaveCount(0)
    await expect(palette).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
    await expect(trigger).toBeFocused()
})

test('file history overlay is a trapped dialog', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click({ button: 'right' })
    await page.locator('.file-context-menu-item', { hasText: 'View history' }).click()

    const dialog = page.locator('.history-view')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'history-title')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.history-view'))).toBe(true)

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.history-view'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('file preview overlay is a trapped dialog', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click()
    await expect(page.locator('.diff-preview-btn')).toBeVisible()
    await page.locator('.diff-preview-btn').click()

    const dialog = page.locator('.preview-view')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'preview-title')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.preview-view'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await page.keyboard.press('Escape')
})

test('blame overlay is a trapped dialog', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click({ button: 'right' })
    await page.locator('.file-context-menu-item', { hasText: 'Blame' }).click()

    const dialog = page.locator('.blame-view')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'blame-title')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.blame-view'))).toBe(true)

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.blame-view'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('reduced motion collapses decorative transitions', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const duration = await page.evaluate(() => {
        const element = document.createElement('div')
        element.style.transition = 'opacity 1s'
        document.body.append(element)
        const value = getComputedStyle(element).transitionDuration
        element.remove()
        return value
    })
    expect(parseFloat(duration)).toBeLessThan(0.001)
})

test('enter on a prompt cancel button cancels instead of submitting', async () => {
    const branch = page.locator('.branch-row').first()
    await branch.click({ button: 'right' })
    await page.locator('.local-branch-menu-item', { hasText: 'Create branch' }).click()

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toBeVisible()
    const cancel = page.locator('.confirm-dialog-actions .btn').first()
    await cancel.focus()
    await page.keyboard.press('Enter')

    await expect(dialog).toHaveCount(0)
})

test('prompt dialog is modal and wraps tab in both directions', async () => {
    const branch = page.locator('.branch-row').first()
    await branch.click({ button: 'right' })
    await page.locator('.local-branch-menu-item', { hasText: 'Create branch' }).click()

    const dialog = page.locator('.confirm-dialog')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-labelledby', 'prompt-dialog-title')
    await expect(page.locator('#prompt-dialog-title')).toHaveText('Create branch')

    const input = page.locator('.prompt-input')
    const create = page.locator('.confirm-dialog-actions .btn.primary')
    await expect(input).toBeFocused()
    await input.fill('e2e-a11y-branch')
    await expect(create).toBeEnabled()

    await page.keyboard.press('Shift+Tab')
    await expect(create).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(input).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})
