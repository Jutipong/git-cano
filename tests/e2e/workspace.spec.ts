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

test.describe('cross-workspace repo search', () => {
    let alt: AppHandle
    let altPage: Page

    test.beforeAll(async () => {
        alt = await launchApp([fx.extraRepos[0]], { workspaces: { Alt: [fx.mainRepo, fx.opsRepo] } })
        altPage = alt.page
        await expect(altPage.locator('.repo-tab')).toHaveCount(1)
    })

    test.afterAll(async () => {
        await alt?.app.close()
    })

    test('palette lists repos from every workspace and switches to the picked one', async () => {
        await altPage.keyboard.press('Control+p')
        await expect(altPage.locator('.palette')).toBeVisible()
        await altPage.locator('.palette-item', { hasText: 'Repo…' }).click()
        await altPage.locator('.palette-input').fill('ops')

        // The repo belongs to Alt, not the workspace we are sitting in — its hint says so.
        const hit = altPage.locator('.palette-item', { hasText: 'ops-repo' })
        await expect(hit).toBeVisible()
        await expect(hit.locator('.palette-hint')).toHaveText('Alt')

        await hit.click()
        await expect(altPage.locator('.palette')).toBeHidden()

        // Switched workspace: Alt's whole session is back and the picked repo is the active tab.
        await expect(altPage.locator('.workspace-btn-name')).toHaveText('Alt')
        await expect(altPage.locator('.repo-tab')).toHaveCount(2)
        await expect(altPage.locator('.repo-tab.active')).toContainText('ops-repo')

        // Only the repo that is really open wears the green "Active" pill.
        await altPage.keyboard.press('Control+p')
        await altPage.locator('.palette-item', { hasText: 'Repo…' }).click()
        await expect(altPage.locator('.palette-badge')).toHaveCount(1)
        await expect(altPage.locator('.palette-item', { hasText: 'ops-repo' }).locator('.palette-badge')).toHaveText('Active')

        // The workspace name finds everything inside it, even though neither repo is named after it.
        // Asserted per row rather than by count: the fixture paths live in a random temp dir that could
        // itself contain the query.
        await altPage.locator('.palette-input').fill('alt')
        await expect(altPage.locator('.palette-item', { hasText: 'main-repo' })).toBeVisible()
        await expect(altPage.locator('.palette-item', { hasText: 'ops-repo' })).toBeVisible()
    })
})

test.describe('repo open in several workspaces', () => {
    let shared: AppHandle
    let sharedPage: Page

    test.beforeAll(async () => {
        // ops-repo is open in both Alt and Team, so the palette must offer one row per workspace.
        shared = await launchApp([fx.extraRepos[0]], { workspaces: { Alt: [fx.opsRepo], Team: [fx.opsRepo] } })
        sharedPage = shared.page
        await expect(sharedPage.locator('.repo-tab')).toHaveCount(1)
    })

    test.afterAll(async () => {
        await shared?.app.close()
    })

    test('lists it once per workspace and switches to the picked one', async () => {
        await sharedPage.keyboard.press('Control+p')
        await sharedPage.locator('.palette-item', { hasText: 'Repo…' }).click()
        await sharedPage.locator('.palette-input').fill('ops-repo')

        // Two rows, one per workspace, in `names` order — not collapsed into the current workspace's.
        const rows = sharedPage.locator('.palette-item', { hasText: 'ops-repo' })
        await expect(rows).toHaveCount(2)
        await expect(rows.nth(0).locator('.palette-hint')).toHaveText('Alt')
        await expect(rows.nth(1).locator('.palette-hint')).toHaveText('Team')
        // Neither row claims to be the open one — Main is the workspace we are in, and it holds neither.
        await expect(sharedPage.locator('.palette-badge')).toHaveCount(0)

        await rows.nth(1).click()
        await expect(sharedPage.locator('.workspace-btn-name')).toHaveText('Team')
        await expect(sharedPage.locator('.repo-tab.active')).toContainText('ops-repo')
    })
})
