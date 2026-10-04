import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

/**
 * A/B memory benchmark. Run explicitly:
 *   GITCANO_BENCH=1 pnpm exec playwright test tests/e2e/memory-bench.spec.ts
 * Against the old build:
 *   GITCANO_BENCH=1 GITCANO_E2E_APP_DIR=<worktree> pnpm exec playwright test tests/e2e/memory-bench.spec.ts
 */
const fx = loadFixtures()
const bench = !!process.env.GITCANO_BENCH
const appDir = process.env.GITCANO_E2E_APP_DIR
const label = process.env.GITCANO_BENCH_LABEL ?? (appDir ? 'old' : 'new')

test.describe.configure({ mode: 'serial' })
test.skip(!bench, 'memory benchmark — set GITCANO_BENCH=1')
test.setTimeout(300_000)

let handle: AppHandle
let page: Page

interface Snapshot {
    mainHeap: number
    mainRss: number
    rendererHeap: number
}

async function snapshot(name: string): Promise<Snapshot> {
    // Force a renderer GC and read the precise heap usage through CDP when available; fall back to
    // performance.memory (quantized) otherwise.
    let renderer = 0
    try {
        const client = await page.context().newCDPSession(page)
        await client.send('HeapProfiler.collectGarbage')
        const usage = (await client.send('Runtime.getHeapUsage')) as { usedSize: number }
        renderer = usage.usedSize
        await client.detach()
    } catch {
        renderer = await page.evaluate(() => {
            const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            return memory?.usedJSHeapSize ?? 0
        })
    }
    await page.waitForTimeout(300)
    const main = await handle.app.evaluate(() => process.memoryUsage())
    const result: Snapshot = { mainHeap: main.heapUsed, mainRss: main.rss, rendererHeap: renderer }
    // oxlint-disable-next-line no-console -- benchmark output
    console.log(
        `BENCH[${label}] ${name} mainHeap=${(result.mainHeap / 1048576).toFixed(1)}MB mainRss=${(result.mainRss / 1048576).toFixed(1)}MB renderer=${(result.rendererHeap / 1048576).toFixed(1)}MB`
    )
    return result
}

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo, fx.bulkRepo, fx.hugeRepo], {
        appDir,
        debugLog: !appDir,
        extraArgs: ['--js-flags=--expose-gc'],
    })
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

/** showEntireFile is a global setting, so only toggle it when the current title says it is off. */
async function ensureEntireFile(): Promise<void> {
    const toggle = page.locator('.segmented-btn.entire-file')
    await expect(toggle).toBeVisible()
    if (((await toggle.getAttribute('title')) ?? '').includes('Show entire file')) await toggle.click()
}

test('memory benchmark', async () => {
    await snapshot('boot')

    // 1) Clicking commits — the old build parsed + shipped the full commit diff every click.
    const bigRow = page.locator('.graph-row', { hasText: 'feat: big commit' }).first()
    const smallRow = page.locator('.graph-row', { hasText: 'chore: add image' }).first()
    // oxlint-disable no-await-in-loop -- sequential clicks are the scenario
    for (let i = 0; i < 5; i++) {
        await bigRow.click()
        await expect(page.locator('.file-row').first()).toBeVisible()
        await smallRow.click()
        await expect(page.locator('.file-row').first()).toBeVisible()
    }
    // oxlint-enable no-await-in-loop
    await snapshot('commit-clicks')

    // 2) Bulk log: scroll to page in several thousand commits (bodies included in the old log payload).
    await page.locator('.repo-tab', { hasText: 'bulk-repo' }).click()
    await expect(page.locator('.graph-row').first()).toBeVisible()
    // oxlint-disable no-await-in-loop -- each scroll triggers the next loadMore page
    for (let i = 0; i < 10; i++) {
        await page.locator('.graph-scroll').evaluate(el => {
            el.scrollTop = el.scrollHeight
        })
        await page.waitForTimeout(350)
    }
    // oxlint-enable no-await-in-loop
    await snapshot('bulk-log')

    // 3) Entire-file diff of a 100k-line file, inline then split (old build materializes every row/context).
    await page.locator('.repo-tab', { hasText: 'huge-repo' }).click()
    await page.locator('.file-row', { hasText: 'huge.txt' }).first().click()
    await ensureEntireFile()
    await expect(page.locator('.diff-line').first()).toBeVisible()
    await page.waitForTimeout(1500)
    await snapshot('huge-entire-inline')
    await page.locator('.segmented-btn[title="Side-by-side view"]').click()
    await page.waitForTimeout(1500)
    await snapshot('huge-entire-split')
    await page.locator('.diff-view .diff-close-btn').click()

    // 3b) 25k-line entire-file view in the main repo — comparable content for both builds (new caps at 20k).
    await page.locator('.repo-tab', { hasText: 'main-repo' }).click()
    await page.locator('.file-row', { hasText: 'large-tracked.txt' }).first().click()
    await page.locator('.segmented-btn[title="Inline (unified) view"]').click()
    await ensureEntireFile()
    await expect(page.locator('.diff-line').first()).toBeVisible()
    await page.waitForTimeout(1200)
    await snapshot('large25k-entire-inline')
    await page.locator('.diff-view .diff-close-btn').click()

    // 4) Image diff (old build transferred base64 data URLs for both sides).
    await page.locator('.file-row', { hasText: 'big.bmp' }).first().click()
    await expect(page.locator('.image-diff')).toBeVisible()
    await page.waitForTimeout(1000)
    await snapshot('image-diff')
})
