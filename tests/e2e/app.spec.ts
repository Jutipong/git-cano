import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

/** Escape closes the topmost overlay/selection — enough presses land on the workdir Changes panel. */
async function clearSelection(): Promise<void> {
    // oxlint-disable no-await-in-loop -- each press closes the next overlay layer
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(80)
    }
    // oxlint-enable no-await-in-loop
}

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo, ...fx.extraRepos.slice(0, 6)])
    page = handle.page
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('boot: seeded workspace opens every repo tab', async () => {
    await expect(page.locator('.repo-tab')).toHaveCount(7)
    await expect(page.locator('.graph-row').first()).toBeVisible()
    expect((await page.locator('.repo-tab-name').allTextContents())[0]).toBe('main-repo')
})

test('commit:details ships files/message but no diff payload', async () => {
    const result = await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        const log = await api.log(200)
        const big = log.find((c: any) => c.subject === 'feat: big commit')
        const details = await api.commitDetails(big.hash)
        return {
            hasDiff: 'diff' in details,
            fileCount: details.files.length,
            message: details.message,
        }
    })
    expect(result.hasDiff).toBe(false)
    expect(result.fileCount).toBe(1)
    expect(result.message).toContain('feat: big commit')
})

test('log ships hasBody marker only; popover loads the body lazily', async () => {
    const result = await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        const log = await api.log(200)
        const withBody = log.find((c: any) => c.subject === 'feat: add notes')
        const withoutBody = log.find((c: any) => c.subject === 'chore: no body commit')
        const solo = await api.logSolo('main', 50)
        const soloWithBody = solo.find((c: any) => c.subject === 'feat: add notes')
        return {
            withHasBody: withBody.hasBody === true,
            withBodyProp: 'body' in withBody,
            withoutHasBody: withoutBody.hasBody ?? null,
            withoutBodyProp: 'body' in withoutBody,
            soloHasBody: soloWithBody?.hasBody === true,
        }
    })
    expect(result.withHasBody).toBe(true)
    expect(result.withBodyProp).toBe(false)
    expect(result.withoutHasBody).toBeNull()
    expect(result.withoutBodyProp).toBe(false)
    expect(result.soloHasBody).toBe(true)

    const row = page.locator('.graph-row', { hasText: 'feat: add notes' }).first()
    await row.locator('.msg-toggle').click()
    await expect(row.locator('.cmp-message')).toContainText('Body line two')
    await expect(row.locator('.cmp-message')).toContainText('Body line three')
    await expect(page.locator('.graph-row', { hasText: 'chore: no body commit' }).first().locator('.msg-toggle')).toHaveCount(0)
})

test('commit:body is repo-pinned (unknown repo errors)', async () => {
    const result = await page.evaluate(async ({ main }: { main: string }) => {
        const api = (window as unknown as { api: any }).api
        const log = await api.log(200)
        const commit = log.find((c: any) => c.subject === 'feat: add notes')
        const body = await api.commitBody(commit.hash, main)
        let error = ''
        try {
            await api.commitBody(commit.hash, `${main}-not-open`)
        } catch (e) {
            error = String(e)
        }
        return { body, error }
    }, { main: fx.mainRepo })
    expect(result.body).toContain('Body line two')
    expect(result.error).toContain('is not open')
})

test('logCache/branchCache are MRU-bounded and touch on read', async () => {
    const paths = [fx.mainRepo, ...fx.extraRepos.slice(0, 6)]
    const result = await page.evaluate(
        async ({ paths, extra7 }: { paths: string[]; extra7: string }) => {
            const api = (window as unknown as { api: any }).api
            // oxlint-disable no-await-in-loop -- the cache order is what this test asserts
            for (const p of paths) {
                await api.setActiveRepo(p)
                await api.log(10)
                await api.branches()
            }
            // oxlint-enable no-await-in-loop
            await api.setActiveRepo(paths[0])
            const mainCached = await api.logCached(10)
            const mainBranches = await api.branchesCached()
            await api.setActiveRepo(paths[1])
            const extra1Cached = await api.logCached(10) // reading touches the entry (MRU)
            await api.openPath(extra7)
            await api.setActiveRepo(extra7)
            await api.log(10) // 7th entry → evicts the oldest (extra-2, since extra-1 was touched)
            await api.setActiveRepo(paths[2])
            const extra2Cached = await api.logCached(10)
            await api.setActiveRepo(paths[1])
            const extra1StillCached = await api.logCached(10)
            await api.setActiveRepo(paths[0])
            return {
                mainEvicted: mainCached === null,
                mainBranchesEvicted: mainBranches === null,
                extra1Cached: extra1Cached !== null,
                extra2Evicted: extra2Cached === null,
                extra1StillCached: extra1StillCached !== null,
            }
        },
        { paths, extra7: fx.extraRepos[6] }
    )
    expect(result).toEqual({
        mainEvicted: true,
        mainBranchesEvicted: true,
        extra1Cached: true,
        extra2Evicted: true,
        extra1StillCached: true,
    })
})

test('diff payloads are capped at 20k lines with a marker', async () => {
    const result = await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        const untracked = await api.diff('untracked-big.txt', false)
        const entireFile = await api.diff('large-tracked.txt', false, 999999)
        return {
            untrackedLength: untracked.length,
            untrackedLast: untracked[untracked.length - 1].text,
            entireLength: entireFile.length,
            entireLast: entireFile[entireFile.length - 1].text,
        }
    })
    expect(result.untrackedLength).toBe(20_001)
    expect(result.untrackedLast).toContain('truncated')
    expect(result.entireLength).toBe(20_001)
    expect(result.entireLast).toContain('truncated')
})

test('image diff renders blob URLs and revokes them on switch', async () => {
    await clearSelection()
    await page.locator('.file-row', { hasText: 'img.png' }).first().click()
    await expect(page.locator('.image-diff')).toBeVisible()
    const images = await page.locator('.image-diff img').evaluateAll(imgs =>
        imgs.map(img => ({ src: (img as HTMLImageElement).src, width: (img as HTMLImageElement).naturalWidth }))
    )
    expect(images).toHaveLength(2)
    expect(images[0]!.src.startsWith('blob:')).toBe(true)
    expect(images[1]!.src.startsWith('blob:')).toBe(true)
    expect(images[0]!.width).toBeGreaterThan(0)
    expect(images[1]!.width).toBeGreaterThan(0)

    const before = await page.evaluate(() => (window as unknown as { __revokes: number }).__revokes)
    await page.locator('.file-row', { hasText: 'mixed.txt' }).first().click()
    await expect(page.locator('.diff-view .diff-line').first()).toBeVisible()
    const after = await page.evaluate(() => (window as unknown as { __revokes: number }).__revokes)
    expect(after - before).toBeGreaterThanOrEqual(2)
})

test('large untracked file renders the truncation marker and a minimap', async () => {
    await page.locator('.file-row', { hasText: 'untracked-big.txt' }).first().click()
    await expect(page.locator('.diff-header strong')).toHaveText('untracked-big.txt')
    await expect(page.locator('.diff-line, .split-hunk-separator').first()).toBeVisible()

    const scrollBottom = async (): Promise<void> => {
        // oxlint-disable no-await-in-loop -- the virtual height settles between attempts
        for (let i = 0; i < 4; i++) {
            await page.locator('.diff-body').evaluate(el => {
                el.scrollTop = el.scrollHeight
            })
            await page.waitForTimeout(150)
        }
        // oxlint-enable no-await-in-loop
    }

    // Split mode: the truncation marker renders as a full-width separator (once per pane).
    await page.locator('.segmented-btn[title="Side-by-side view"]').click()
    await scrollBottom()
    await expect(page.locator('.split-hunk-separator', { hasText: 'truncated' }).first()).toBeVisible()

    // Inline mode: the same marker renders as a meta row.
    await page.locator('.segmented-btn[title="Inline (unified) view"]').click()
    await scrollBottom()
    await expect(page.locator('.diff-line.meta').last()).toContainText('truncated')
    await expect(page.locator('.diff-minimap')).toBeVisible()
})

test('split view renders from the segment plan with working navigation', async () => {
    await page.locator('.file-row', { hasText: 'mixed.txt' }).first().click()
    await expect(page.locator('.diff-view .diff-line').first()).toBeVisible()
    await page.locator('.segmented-btn[title="Side-by-side view"]').click()
    await expect(page.locator('.split-pane.left .diff-line').first()).toBeVisible()
    await expect(page.locator('.split-pane.right .diff-line').first()).toBeVisible()

    // Uneven del/add block must produce a blank pad row on one side.
    await expect(page.locator('.split-pane.left .diff-line.blank, .split-pane.right .diff-line.blank').first()).toBeVisible()

    const changeCounter = page.locator('.diff-nav[title="Navigate between changes"] .diff-nav-counter')
    await expect(changeCounter).toHaveText(/^1\/\d+$/)
    await page.locator('.diff-nav[title="Navigate between changes"] button[title="Next change"]').click()
    await expect(changeCounter).toHaveText(/^2\/\d+$/)

    await page.locator('.diff-search-input').fill('MAGIC_TOKEN')
    await page.locator('.diff-search-input').press('Enter')
    await expect(page.locator('.diff-line.search-current')).toHaveCount(1)

    await page.locator('.segmented-btn[title="Inline (unified) view"]').click()
    await expect(page.locator('.diff-body .diff-line').first()).toBeVisible()
})

test('tokenizer state carries across rendered diff rows', async () => {
    await clearSelection()
    await page.locator('.file-row', { hasText: 'state.js' }).first().click()
    await expect(page.locator('.diff-view')).toBeVisible()
    await page.locator('.segmented-btn[title="Inline (unified) view"]').click()
    const middle = page.locator('.diff-line.ctx', { hasText: 'middle line inside comment' })
    await expect(middle).toBeVisible()
    await expect(middle.locator('.tok-comment')).toHaveCount(1)
})

test('blame lens still resolves authorship', async () => {
    await page.locator('.file-row', { hasText: 'mixed.txt' }).first().click()
    // A committed context line (the added lines are uncommitted in the worktree and blame as such).
    const committedLine = page.locator('.diff-line.ctx', { hasText: 'alpha' }).first()
    await expect(committedLine).toBeVisible()
    await page.locator('.segmented-btn[title="Blame lens — hover a line number for authorship"]').click()
    // Clicking a real code line's number opens the lens immediately (the hover path adds a 450ms delay on top).
    await committedLine.locator('.ln').last().click()
    await expect(page.locator('.blame-lens-tip')).toContainText('E2E User', { timeout: 20_000 })
})

test('graph search, squash range and context menu still work', async () => {
    await clearSelection()
    await page.locator('.commit-search input').fill('feat: add notes')
    await expect(page.locator('.graph-row')).toHaveCount(1)
    await page.locator('.commit-search input').fill('')
    await expect(page.locator('.graph-row')).toHaveCount(8)

    const rows = page.locator('.graph-row')
    await rows.nth(0).click()
    await rows.nth(1).click({ modifiers: ['Shift'] })
    await expect(page.locator('.solo-chip').filter({ hasText: 'Squash' })).toBeVisible()
    await page.keyboard.press('Escape')

    await rows.nth(0).click({ button: 'right' })
    await expect(page.locator('.commit-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.commit-menu')).toHaveCount(0)
})

test('clicking large commits stays within a bounded memory envelope', async () => {
    await clearSelection()
    await page.locator('.repo-tab').first().click()
    await expect(page.locator('.graph-row').first()).toBeVisible()

    const bigRow = page.locator('.graph-row', { hasText: 'feat: big commit' }).first()
    const smallRow = page.locator('.graph-row', { hasText: 'chore: add image' }).first()
    const beforeMain = await handle.app.evaluate(() => process.memoryUsage().heapUsed)
    const beforeRenderer = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)

    // oxlint-disable no-await-in-loop -- sequential clicks are the scenario under test
    for (let i = 0; i < 3; i++) {
        await bigRow.click()
        await expect(page.locator('.file-row').first()).toBeVisible()
        await smallRow.click()
        await expect(page.locator('.file-row').first()).toBeVisible()
    }
    // oxlint-enable no-await-in-loop

    const afterMain = await handle.app.evaluate(() => process.memoryUsage().heapUsed)
    const afterRenderer = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
    // oxlint-disable-next-line no-console -- the numbers are part of the test evidence
    console.log(
        `[memory] main heap ${(beforeMain / 1048576).toFixed(1)}MB → ${(afterMain / 1048576).toFixed(1)}MB; renderer JS heap ${(beforeRenderer / 1048576).toFixed(1)}MB → ${(afterRenderer / 1048576).toFixed(1)}MB`
    )
    expect(afterMain - beforeMain).toBeLessThan(200 * 1024 * 1024)
})

test('stage/unstage and hunk staging still work', async () => {
    await clearSelection()
    const initial = await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        return (await api.status()).files.find((f: any) => f.path === 'untracked-big.txt')
    })
    expect(initial?.unstaged).toBe('?')

    const row = page.locator('.file-row', { hasText: 'untracked-big.txt' }).first()
    await row.hover()
    await row.locator('button[title="Stage"]').click()
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const api = (window as unknown as { api: any }).api
                return (await api.status()).files.find((f: any) => f.path === 'untracked-big.txt')?.staged
            })
        )
        .toBe('A')

    const stagedRow = page.locator('.file-row', { hasText: 'untracked-big.txt' }).first()
    await stagedRow.hover()
    await stagedRow.locator('button[title="Unstage"]').click()
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const api = (window as unknown as { api: any }).api
                return (await api.status()).files.find((f: any) => f.path === 'untracked-big.txt')?.unstaged
            })
        )
        .toBe('?')

    // Hunk staging path (rawPatch → stageHunks) is untouched by the payload changes but must still work.
    await page.locator('.file-row', { hasText: 'mixed.txt' }).first().click()
    await expect(page.locator('.diff-view .diff-line').first()).toBeVisible()
    await page.locator('.diff-body .hunk-action').first().click()
    await expect(page.locator('.toast').filter({ hasText: 'staged' })).toBeVisible()
    await page.evaluate(() => (window as unknown as { api: any }).api.unstageAll())
})

test('AI context cap keeps a huge staged diff bounded', async () => {
    await clearSelection()
    const result = await page.evaluate(
        async ({ main }: { main: string }) => {
            const api = (window as unknown as { api: any }).api
            await api.ai.saveConfig({
                provider: 'opencode-go',
                opencodeGo: { token: 'e2e-fake-token', modelId: 'fake-model', models: [] },
                openrouter: { token: '', modelId: '', models: [] },
                commitInstructions: '',
            })
            await api.stageAll(main)
            const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            const before = memory?.usedJSHeapSize ?? 0
            const started = Date.now()
            let error = ''
            try {
                await api.ai.generateCommitMessage(false, 'all', main)
            } catch (e) {
                error = String(e)
            }
            const elapsed = Date.now() - started
            const after = memory?.usedJSHeapSize ?? 0
            await api.unstageAll()
            return { error, elapsed, delta: after - before }
        },
        { main: fx.mainRepo }
    )
    // oxlint-disable-next-line no-console -- the numbers are part of the test evidence
    console.log(
        `[ai] elapsed=${result.elapsed}ms rendererDelta=${(result.delta / 1048576).toFixed(1)}MB error="${result.error.slice(0, 90)}"`
    )
    expect(result.error).not.toBe('')
    expect(result.elapsed).toBeLessThan(45_000)
    expect(result.delta).toBeLessThan(200 * 1024 * 1024)
})
