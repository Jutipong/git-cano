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

test('a pushed tag is marked on remote, a local-only tag stays unmarked', async () => {
    await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        await api.createTag('e2e-pushed-tag', null)
        await api.createTag('e2e-local-tag', null)
        await api.pushTag('e2e-pushed-tag')
    })
    expect(git(fx.remote.bare, ['tag', '--list', 'e2e-pushed-tag'])).toBe('e2e-pushed-tag')

    // Tag data is opt-in: the section's refresh button reloads local + remote tags.
    await page.getByRole('button', { name: 'Refresh tags' }).click()

    const pushed = page.locator('.tag-row', { hasText: 'e2e-pushed-tag' })
    const local = page.locator('.tag-row', { hasText: 'e2e-local-tag' })
    await expect(pushed).toBeVisible()
    await expect(local).toBeVisible()

    // Being on the remote is the mark: the pushed tag's icon turns orange, the local-only tag stays plain.
    await expect(pushed.locator('.tag-on-remote')).toHaveCount(1)
    await expect(local.locator('.tag-on-remote')).toHaveCount(0)
    const orange = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--orange)'
        document.body.appendChild(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
    })
    expect(await pushed.locator('.tag-on-remote').evaluate(el => getComputedStyle(el).color)).toBe(orange)
})
