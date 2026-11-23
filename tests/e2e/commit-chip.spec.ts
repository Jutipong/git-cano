import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.chipRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

function currentBranch(): Promise<string | undefined> {
    return page.evaluate(() => (window as unknown as { api: any }).api.branches().then((b: any) => b.local.find((x: any) => x.current)?.name))
}

async function openRowMenu(): Promise<void> {
    await page.locator('.graph-row').first().locator('.node-avatar').click({ button: 'right' })
    await expect(page.locator('.commit-menu')).toBeVisible()
}

test('the commit menu lists every branch at the tip above the detached checkout', async () => {
    await openRowMenu()
    const menu = page.locator('.commit-menu')
    await expect(menu.getByRole('menuitem', { name: 'Checkout dev', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Checkout dev-2', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Checkout remote-dev (track origin/remote-dev)', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Checkout [0-9a-f]{7,}$/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
})

test('right-clicking a branch chip opens the same menu and checks the branch out', async () => {
    await page.locator('.ref-chip[title="dev"]').click({ button: 'right' })
    const menu = page.locator('.commit-menu')
    await expect(menu.getByRole('menuitem', { name: 'Checkout dev', exact: true })).toBeVisible()

    await menu.getByRole('menuitem', { name: 'Checkout dev', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Checked out dev' })).toBeVisible()
    expect(await currentBranch()).toBe('dev')
})

test('each branch item targets its own branch and the current branch is omitted', async () => {
    await openRowMenu()
    const menu = page.locator('.commit-menu')
    await expect(menu.getByRole('menuitem', { name: 'Checkout dev', exact: true })).toHaveCount(0)

    await menu.getByRole('menuitem', { name: 'Checkout dev-2', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Checked out dev-2' })).toBeVisible()
    expect(await currentBranch()).toBe('dev-2')

    await openRowMenu()
    await menu.getByRole('menuitem', { name: 'Checkout main', exact: true }).click()
    await expect(page.locator('.toast', { hasText: 'Checked out main' })).toBeVisible()
    expect(await currentBranch()).toBe('main')
})

test('a remote-only branch checks out as a local tracking branch', async () => {
    await openRowMenu()
    await page
        .locator('.commit-menu')
        .getByRole('menuitem', { name: 'Checkout remote-dev (track origin/remote-dev)', exact: true })
        .click()
    await expect(page.locator('.toast', { hasText: 'Checked out remote-dev' })).toBeVisible()
    expect(await currentBranch()).toBe('remote-dev')
})
