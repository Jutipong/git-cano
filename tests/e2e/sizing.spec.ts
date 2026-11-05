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
    const px = await locator.evaluate(el => parseFloat(getComputedStyle(el).height))
    // Flex layout can land a box a hair under its token (27.99 for 28px); compare whole pixels.
    return Math.round(px)
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

test('sidebar section cards resize with the keyboard and reset on double-click', async () => {
    const resizer = page.locator('.sidebar-section-resizer[aria-label="Resize local branches section"]')
    await expect(resizer).toBeVisible()
    const local = page.locator('[data-sidebar-section="local"]')
    const before = Math.round(await height(local))

    await resizer.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round(await height(local))).toBe(before + 10)
    await expect(resizer).toHaveAttribute('aria-valuenow', String(before + 10))
    // Shift steps faster, like the panel splitters.
    await page.keyboard.press('Shift+ArrowUp')
    await expect.poll(async () => Math.round(await height(local))).toBe(before - 30)

    // Pointer drag moves the card by the same delta.
    const box = await resizer.boundingBox()
    if (!box) throw new Error('Sidebar resizer has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Math.round(await height(local))).toBe(before - 10)

    // Double-click drops the pinned height and hands the card back to the automatic flex layout.
    await resizer.dblclick()
    await expect(local).not.toHaveAttribute('style', /height/)
})

test('the three-column layout fits the minimum window width', async () => {
    await handle.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1000, 760)
    })
    // The renderer reacts to the resize event; poll until the narrow layout has been laid out.
    await expect
        .poll(() =>
            page.evaluate(() => {
                const app = document.querySelector('.app')!
                return app.scrollWidth - window.innerWidth
            })
        )
        .toBeLessThanOrEqual(0)

    const metrics = await page.evaluate(() => {
        const app = document.querySelector('.app')!
        const rightPane = document.querySelector('.right-pane')!
        const sync = document.querySelector('.tab-sync-actions')!
        const syncBox = sync.getBoundingClientRect()
        const paneBox = rightPane.getBoundingClientRect()
        return {
            inner: window.innerWidth,
            appScroll: app.scrollWidth,
            syncRight: syncBox.right,
            syncOverflow: sync.scrollWidth - sync.clientWidth,
            paneRight: paneBox.right,
        }
    })
    expect(metrics.appScroll).toBeLessThanOrEqual(metrics.inner)
    // Stashes sits at the end of the sync pill — the 340px panel change used to clip it.
    expect(metrics.syncOverflow).toBeLessThanOrEqual(1)
    expect(metrics.syncRight).toBeLessThanOrEqual(metrics.inner + 1)
    expect(metrics.paneRight).toBeLessThanOrEqual(metrics.inner + 1)

    await handle.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1400, 900)
    })
})

test('a pinned sidebar card fills the leftover space in one drag', async () => {
    // The footer's `margin-top: auto` used to count as reserved space, which capped the computed max at roughly
    // the card's current height: a drag stalled after a few pixels and every re-grab creeped a little further.
    const local = page.locator('[data-sidebar-section="local"]')
    const localResizer = page.locator('.sidebar-section-resizer[aria-label="Resize local branches section"]')
    const tags = page.locator('[data-sidebar-section="tags"]')
    const tagsResizer = page.locator('.sidebar-section-resizer[aria-label="Resize tags section"]')

    const drag = async (resizer: Locator, dy: number) => {
        const box = await resizer.boundingBox()
        if (!box) throw new Error('Sidebar resizer has no box')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 10 })
        await page.mouse.up()
    }

    // Pin both growing cards so the space freed below stays unused instead of being absorbed by flex.
    await drag(localResizer, 40)
    await drag(tagsResizer, 20)
    await expect(local).toHaveAttribute('style', /height/)
    await expect(tags).toHaveAttribute('style', /height/)

    // Collapsing REMOTE and STASHES leaves a large empty area under TAGS.
    await page.locator('[data-sidebar-section="remote"] .section-toggle').click()
    await page.locator('[data-sidebar-section="stashes"] .section-toggle').click()
    await expect(page.locator('[data-sidebar-section="remote"].collapsed')).toHaveCount(1)

    // One drag must claim that whole area instead of creeping a few pixels per attempt.
    const before = await height(tags)
    await drag(tagsResizer, 400)
    expect(await height(tags)).toBeGreaterThan(before + 150)

    // The cards now sit on the footer: there is no dead gap left to creep into.
    const gap = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.sidebar > [data-sidebar-section]')]
        const footer = document.querySelector('.sidebar-bottom')
        const last = cards[cards.length - 1]
        return footer.getBoundingClientRect().top - last.getBoundingClientRect().bottom
    })
    expect(gap).toBeLessThan(20)
})
