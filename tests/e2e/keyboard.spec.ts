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
    await expect(page.locator('.graph-row').first()).toBeVisible()
    await page.locator('.splash-screen').waitFor({ state: 'detached' })
})

test.afterAll(async () => {
    await handle?.app.close()
})

function activeClass(): Promise<string> {
    return page.evaluate(() => (document.activeElement?.className ?? '').toString())
}

test('commit graph moves selection with the keyboard', async () => {
    const graph = page.locator('.graph-scroll')
    await graph.focus()
    await page.keyboard.press('ArrowDown')
    const first = await graph.getAttribute('aria-activedescendant')
    expect(first).toMatch(/^graph-row-/)
    await expect(page.locator('.graph-row[aria-selected="true"]')).toHaveCount(1)

    await page.keyboard.press('ArrowDown')
    const second = await graph.getAttribute('aria-activedescendant')
    expect(second).not.toBe(first)

    await page.keyboard.press('End')
    await expect(page.locator('.graph-row[aria-selected="true"]')).toBeVisible()
    const last = await graph.getAttribute('aria-activedescendant')
    expect(last).toMatch(/^graph-row-/)

    await page.keyboard.press('Home')
    expect(await graph.getAttribute('aria-activedescendant')).toBe(first)
})

test('commit menu opens from the graph and walks items/submenu with arrows', async () => {
    const graph = page.locator('.graph-scroll')
    await graph.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Shift+F10')

    const menu = page.locator('.commit-menu')
    await expect(menu).toHaveAttribute('role', 'menu')
    await expect(menu).toBeVisible()
    expect(await page.evaluate(() => !!document.activeElement?.closest('.commit-menu'))).toBe(true)

    await page.keyboard.press('ArrowDown')
    expect(await activeClass()).toContain('commit-menu-item')

    const submenuTrigger = page.locator('.commit-menu-item.has-sub')
    await submenuTrigger.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.commit-menu-sub')).toBeVisible()
    expect(await page.evaluate(() => !!document.activeElement?.closest('.commit-menu-sub'))).toBe(true)

    await page.keyboard.press('ArrowLeft')
    await expect(submenuTrigger).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(graph).toBeFocused()
})

test('file context submenu supports ArrowRight and Escape', async () => {
    await page.locator('.repo-tab.active').click()
    await expect(page.locator('.file-row', { hasText: 'notes.md' }).first()).toBeVisible()
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click({ button: 'right' })
    const menu = page.locator('.file-context-menu')
    await expect(menu).toHaveAttribute('role', 'menu')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.file-context-menu'))).toBe(true)

    const trigger = page.locator('.file-context-menu-item.has-sub')
    await trigger.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.file-context-menu-sub')).toBeVisible()
    expect(await page.evaluate(() => !!document.activeElement?.closest('.file-context-menu-sub'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
})

test('branch context menu focuses its first item and walks with arrows', async () => {
    await page.locator('.branch-row').first().click({ button: 'right' })
    const menu = page.locator('.local-branch-menu')
    await expect(menu).toHaveAttribute('role', 'menu')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.local-branch-menu'))).toBe(true)

    await page.keyboard.press('ArrowDown')
    expect(await activeClass()).toContain('local-branch-menu-item')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
})

test('sidebar branch rows are keyboard reachable', async () => {
    const list = page.locator('.section-body[aria-label="Local branches"]')
    await list.focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('branch-row') ?? false)).toBe(true)

    await page.keyboard.press('Shift+F10')
    await expect(page.locator('.local-branch-menu')).toHaveAttribute('role', 'menu')
    await page.keyboard.press('Escape')
    await expect(page.locator('.local-branch-menu')).toHaveCount(0)
})

test('file list rows are keyboard reachable', async () => {
    const list = page.locator('.file-groups')
    await list.focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.dir-row, .file-row'))).toBe(true)

    await page.keyboard.press('Shift+F10')
    await expect(page.locator('.context-menu, .file-context-menu').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.context-menu, .file-context-menu')).toHaveCount(0)
})

test('file history rows are keyboard reachable', async () => {
    await page.locator('.file-row', { hasText: 'notes.md' }).first().click({ button: 'right' })
    await page.locator('.file-context-menu-item', { hasText: 'View history' }).click()
    await expect(page.locator('.history-row').first()).toBeVisible()
    const list = page.locator('.history-list')
    await list.focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('history-row') ?? false)).toBe(true)
    await page.keyboard.press('Enter')
    await expect(page.locator('.history-row.selected').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.history-view')).toHaveCount(0)
})

test('reflog rows are keyboard reachable', async () => {
    await page.keyboard.press('Control+p')
    await page.locator('.palette-input').fill('reflog')
    await page.locator('.palette-item', { hasText: 'Reflog' }).click()
    const list = page.locator('.reflog-list')
    await list.focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('reflog-row') ?? false)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('.reflog-row')).toHaveCount(0)
})

test('open repository popover is keyboard navigable', async () => {
    const trigger = page.locator('.tab-new').first()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = page.locator('.open-repo-pop')
    await expect(menu).toHaveAttribute('role', 'menu')
    expect(await page.evaluate(() => !!document.activeElement?.closest('.open-repo-pop'))).toBe(true)

    await page.keyboard.press('ArrowDown')
    expect(await activeClass()).toContain('open-repo-item')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()
})

test('repo tabs move with the arrow keys', async () => {
    const tabs = page.locator('.repo-tab')
    await expect(tabs).toHaveCount(2)
    const first = await page.locator('.repo-tab.active .repo-tab-name').textContent()
    await page.locator('.repo-tab.active').focus()

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.repo-tab.active')).toBeFocused()
    const second = await page.locator('.repo-tab.active .repo-tab-name').textContent()
    expect(second).not.toBe(first)

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.repo-tab.active .repo-tab-name')).toHaveText(first ?? '')
})

test('sidebar and changes splitters resize with arrows', async () => {
    const sidebar = page.locator('.panel-splitter[aria-label="Resize sidebar"]')
    expect(await sidebar.getAttribute('aria-valuenow')).toBe('280')
    await sidebar.focus()
    await page.keyboard.press('ArrowRight')
    await expect(sidebar).toHaveAttribute('aria-valuenow', '290')
    await page.keyboard.press('End')
    await expect(sidebar).toHaveAttribute('aria-valuenow', '380')
    await page.keyboard.press('Home')
    await expect(sidebar).toHaveAttribute('aria-valuenow', '280')

    const changes = page.locator('.panel-splitter[aria-label="Resize changes panel"]')
    expect(await changes.getAttribute('aria-valuenow')).toBe('360')
    await changes.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(changes).toHaveAttribute('aria-valuenow', '370')
    await page.keyboard.press('Home')
    await expect(changes).toHaveAttribute('aria-valuenow', '360')
})

test('terminal splitter resizes with arrows', async () => {
    await page.keyboard.press('Control+`')
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused({ timeout: 30_000 })
    const splitter = page.locator('.terminal-splitter')
    await expect(splitter).toBeVisible()
    const before = Number(await splitter.getAttribute('aria-valuenow'))
    await splitter.focus()
    await page.keyboard.press('ArrowUp')
    await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 10))
    await splitter.focus()
    await page.keyboard.press('ArrowDown')
    await expect(splitter).toHaveAttribute('aria-valuenow', String(before))
    await page.keyboard.press('Control+`')
    await expect(splitter).toHaveCount(0)
})

test('settings tabs move with arrows, Home and End', async () => {
    await page.keyboard.press('Control+,')
    const tabs = page.locator('.tools-tabs .graph-filter')
    await expect(tabs.first()).toBeVisible()
    await page.locator('.tools-tabs .graph-filter.active').focus()

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.tools-tabs .graph-filter.active')).toContainText('General')
    await expect(page.locator('#settings-panel')).toBeVisible()
    await expect(page.locator('#settings-panel')).toHaveAttribute('aria-labelledby', 'settings-tab-general')

    await page.keyboard.press('End')
    await expect(page.locator('.tools-tabs .graph-filter.active')).toContainText('Shortcuts')
    await page.keyboard.press('Home')
    await expect(page.locator('.tools-tabs .graph-filter.active')).toContainText('Appearance')

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})
