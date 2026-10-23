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

function git(args: string[]): string {
    return execFileSync('git', args, { cwd: fx.pickRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commitRow(subject: string) {
    return page.locator('.graph-row').filter({ hasText: subject }).first()
}

function pickMenuItem() {
    return page.locator('.commit-menu-item', { hasText: 'Cherry-pick onto HEAD' })
}

test.beforeAll(async () => {
    handle = await launchApp([fx.pickRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('cherry-pick is blocked on a dirty worktree and changes nothing', async () => {
    const head = git(['rev-parse', 'HEAD'])
    const scratch = path.join(fx.pickRepo, 'scratch.txt')
    fs.writeFileSync(scratch, 'scratch\n')

    await commitRow('feat: topic change').click({ button: 'right' })
    await pickMenuItem().click()

    await expect(page.locator('.confirm-dialog')).toContainText('Uncommitted changes')
    await page.keyboard.press('Escape')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)

    expect(git(['rev-parse', 'HEAD'])).toBe(head)
    expect(git(['status', '--porcelain'])).toContain('scratch.txt')
    fs.rmSync(scratch)
})

test('clean cherry-pick applies the commit and Undo reverts it', async () => {
    const head = git(['rev-parse', 'HEAD'])

    await commitRow('feat: topic change').click({ button: 'right' })
    await pickMenuItem().click()
    await expect(page.locator('.confirm-dialog')).toContainText('Can be picked without conflicts')
    await page.locator('.confirm-dialog').getByRole('button', { name: 'Cherry-pick', exact: true }).click()

    await expect(page.locator('.toast').filter({ hasText: 'Cherry-picked' })).toBeVisible()
    expect(git(['log', '-1', '--format=%s'])).toBe('feat: topic change')
    expect(fs.existsSync(path.join(fx.pickRepo, 'topic.txt'))).toBe(true)

    await page.locator('.toast-action', { hasText: 'Undo' }).click()
    await expect.poll(() => git(['rev-parse', 'HEAD'])).toBe(head)
    expect(fs.existsSync(path.join(fx.pickRepo, 'topic.txt'))).toBe(false)
})

test('conflicting cherry-pick shows the error and leaves the pick in progress', async () => {
    await commitRow('feat: clash side').click({ button: 'right' })
    await pickMenuItem().click()
    await expect(page.locator('.confirm-dialog')).toContainText('Cherry-pick will cause conflicts — 1 file(s)')
    await page.locator('.confirm-dialog').getByRole('button', { name: 'Cherry-pick', exact: true }).click()

    const error = page.locator('.error-dialog')
    await expect(error).toBeVisible()
    await expect(error).toContainText('Cherry-pick stopped due to conflicts. Resolve them, then continue.')
    await page.keyboard.press('Escape')
    await expect(error).toHaveCount(0)

    const state = await page.evaluate(() => (window as unknown as { api: any }).api.repoState())
    expect(state.cherryPicking).toBe(true)

    await page.evaluate(() => (window as unknown as { api: any }).api.cherryPickAbort())
    await expect
        .poll(() =>
            page.evaluate(() =>
                (window as unknown as { api: any }).api.repoState().then((s: { cherryPicking: boolean }) => s.cherryPicking)
            )
        )
        .toBe(false)
})

test('dragging a commit onto another branch checks it out and picks there', async () => {
    await commitRow('feat: topic change').dragTo(page.locator('.branch-row').filter({ has: page.getByText('release', { exact: true }) }))

    await expect(page.locator('.confirm-dialog')).toContainText('Will checkout "release" first')
    await page.locator('.confirm-dialog').getByRole('button', { name: 'Cherry-pick', exact: true }).click()

    await expect(page.locator('.toast').filter({ hasText: 'onto release' })).toBeVisible()
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('release')
    expect(git(['show', 'release:topic.txt'])).toBe('topic')
})
