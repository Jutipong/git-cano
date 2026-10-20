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
    await page.locator('.splash-screen').waitFor({ state: 'detached' })
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('theme picker only offers the shipped themes', async () => {
    await page.keyboard.press('Control+,')
    await expect(page.locator('.tools-modal')).toBeVisible()

    await Promise.all(
        ['Dark Neon', 'Dark Retro'].map(removed =>
            expect(page.getByRole('button', { name: removed, exact: true })).toHaveCount(0)
        )
    )
    await Promise.all(
        ['Dark', 'Dark Modern', 'Light', 'Light Retro', 'Win9x', 'Win9x Dark'].map(theme =>
            expect(page.getByRole('button', { name: theme, exact: true })).toHaveCount(1)
        )
    )

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('theme tokens resolve from the single styles.css source', async () => {
    await page.keyboard.press('Control+,')
    await expect(page.locator('.tools-modal')).toBeVisible()

    const read = (name: string) =>
        page.evaluate(token => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name)
    const select = async (name: string) => {
        await page.getByRole('button', { name, exact: true }).click()
        await page.waitForTimeout(50)
    }

    await select('Dark')
    expect(await read('--pink')).toBe('#ff6fae')
    expect(await read('--diff-row-tint')).toBe('15%')
    expect(await read('--diff-mark-strength')).toBe('45%')

    await select('Dark Modern')
    expect(await read('--pink')).toBe('#ff7eb6')

    await select('Light')
    expect(await read('--pink')).toBe('#960f4e')
    expect(await read('--diff-mark-strength')).toBe('27%')

    await select('Light Retro')
    expect(await read('--font-ui')).toBe("'SF Mono', Menlo, 'Cascadia Mono', Consolas, monospace")
    expect(await read('--shadow')).toBe('4px 4px 0 #111111')
    expect(await read('--diff-mark-strength')).toBe('45%')

    await select('Win9x')
    expect(await read('--pink')).toBe('#960f4e')
    expect(await read('--diff-mark-strength')).toBe('27%')

    await select('Win9x Dark')
    expect(await read('--diff-mark-strength')).toBe('45%')

    await page.keyboard.press('Escape')
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('a persisted removed theme falls back to dark', async () => {
    await page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('ui') ?? '{}') as Record<string, unknown>
        stored.theme = 'terminal'
        localStorage.setItem('ui', JSON.stringify(stored))
    })
    await page.reload()
    await expect(page.locator('.graph-row').first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('ui') ?? '{}') as Record<string, unknown>
        stored.theme = 'dark-neon'
        localStorage.setItem('ui', JSON.stringify(stored))
    })
    await page.reload()
    await expect(page.locator('.graph-row').first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
