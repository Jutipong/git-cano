import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

test.beforeAll(async () => {
    handle = await launchApp([fx.remote.main])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('push publishes the local commit to the bare remote', async () => {
    fs.appendFileSync(path.join(fx.remote.main, 'readme.md'), 'local change\n')
    await page.evaluate(async (repo: string) => {
        const api = (window as unknown as { api: any }).api
        await api.stageAll(repo)
        await api.commitWithAmend('feat: local change', false, repo)
    }, fx.remote.main)

    await page.locator('.tab-sync-actions button', { hasText: 'Push' }).click()
    await expect.poll(() => git(fx.remote.bare, ['rev-parse', 'main'])).toBe(git(fx.remote.main, ['rev-parse', 'HEAD']))
})

test('fetch shows the peer commit and pull brings it in', async () => {
    // The app pushed a local commit in the previous test — fast-forward the peer first.
    git(fx.remote.peer, ['pull', '--ff-only'])
    fs.writeFileSync(path.join(fx.remote.peer, 'peer.txt'), 'peer change\n')
    git(fx.remote.peer, ['add', 'peer.txt'])
    git(fx.remote.peer, ['commit', '-m', 'feat: peer change'])
    git(fx.remote.peer, ['push'])

    await page.locator('.tab-sync-actions button', { hasText: 'Fetch' }).click()
    await expect
        .poll(() =>
            page.evaluate(() => {
                const api = (window as unknown as { api: any }).api
                return api.status().then((status: { behind: number }) => status.behind)
            })
        )
        .toBeGreaterThan(0)

    await page.locator('.tab-sync-actions button', { hasText: 'Pull' }).click()
    await expect.poll(() => fs.existsSync(path.join(fx.remote.main, 'peer.txt'))).toBe(true)
    await expect.poll(() => git(fx.remote.main, ['rev-parse', 'HEAD'])).toBe(git(fx.remote.peer, ['rev-parse', 'HEAD']))
})
