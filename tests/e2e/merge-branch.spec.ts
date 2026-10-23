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
    return execFileSync('git', args, { cwd: fx.mergeRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function branchRow(name: string) {
    return page.locator('.branch-row').filter({ has: page.getByText(name, { exact: true }) })
}

function mergeMenuItem(source: string, target: string) {
    return page.locator('.local-branch-menu-item', { hasText: `Merge ${source} into ${target}` })
}

function confirmMerge() {
    return page.locator('.confirm-dialog').getByRole('button', { name: 'Merge', exact: true })
}

test.beforeAll(async () => {
    handle = await launchApp([fx.mergeRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('merge is blocked on a dirty worktree and changes nothing', async () => {
    const head = git(['rev-parse', 'HEAD'])
    const scratch = path.join(fx.mergeRepo, 'scratch.txt')
    fs.writeFileSync(scratch, 'scratch\n')

    await branchRow('side-branch').click({ button: 'right' })
    await mergeMenuItem('side-branch', 'main').click()

    await expect(page.locator('.confirm-dialog')).toContainText('Uncommitted changes')
    await page.keyboard.press('Escape')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)

    expect(git(['rev-parse', 'HEAD'])).toBe(head)
    fs.rmSync(scratch)
})

test('fast-forward merge moves the branch and Undo restores it', async () => {
    const before = git(['rev-parse', 'HEAD'])
    const tip = git(['rev-parse', 'ff-branch'])

    await branchRow('ff-branch').click({ button: 'right' })
    await mergeMenuItem('ff-branch', 'main').click()
    await expect(page.locator('.confirm-dialog')).toContainText('Fast-forward — no conflicts possible')
    await confirmMerge().click()

    await expect(page.locator('.toast').filter({ hasText: 'Merged ff-branch into main' })).toBeVisible()
    expect(git(['rev-parse', 'HEAD'])).toBe(tip)

    await page.locator('.toast-action', { hasText: 'Undo' }).click()
    await expect.poll(() => git(['rev-parse', 'HEAD'])).toBe(before)
})

test('diverged clean merge creates a merge commit with both sides', async () => {
    await branchRow('side-branch').click({ button: 'right' })
    await mergeMenuItem('side-branch', 'main').click()
    await expect(page.locator('.confirm-dialog')).toContainText('Merge can be done without conflicts')
    await confirmMerge().click()

    await expect(page.locator('.toast').filter({ hasText: 'Merged side-branch into main' })).toBeVisible()
    expect(git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(3)
    expect(fs.existsSync(path.join(fx.mergeRepo, 'side.txt'))).toBe(true)
    expect(fs.existsSync(path.join(fx.mergeRepo, 'main.txt'))).toBe(true)
})

test('conflicting merge into the current branch shows the error and leaves the merge in progress', async () => {
    const head = git(['rev-parse', 'HEAD'])

    await branchRow('conflict-branch').click({ button: 'right' })
    await mergeMenuItem('conflict-branch', 'main').click()
    await expect(page.locator('.confirm-dialog')).toContainText('Merge will cause conflicts — 1 file(s)')
    await confirmMerge().click()

    await expect(page.locator('.error-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.error-dialog')).toHaveCount(0)

    expect(git(['rev-parse', 'HEAD'])).toBe(head)
    const state = await page.evaluate(() => (window as unknown as { api: any }).api.repoState())
    expect(state.merging).toBe(true)

    await page.evaluate(() => (window as unknown as { api: any }).api.abortMerge())
    await expect.poll(() => git(['status', '--porcelain'])).toBe('')
})

test('dragging a branch onto a non-current branch merges without switching', async () => {
    await branchRow('side-branch').dragTo(branchRow('release'))

    await expect(page.locator('.confirm-dialog')).toContainText('Merges without switching your current branch.')
    await confirmMerge().click()

    await expect(page.locator('.toast').filter({ hasText: 'Merged side-branch into release' })).toBeVisible()
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
    expect(git(['rev-list', '--parents', '-n', '1', 'release']).split(' ')).toHaveLength(3)
})

test('dragging a conflicting branch onto a non-current branch checks it out and surfaces the conflict', async () => {
    await branchRow('conflict-branch').dragTo(branchRow('conflict-release'))

    await expect(page.locator('.confirm-dialog')).toContainText('Will checkout "conflict-release" to resolve conflicts.')
    await confirmMerge().click()

    await expect(page.locator('.error-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('conflict-release')

    const state = await page.evaluate(() => (window as unknown as { api: any }).api.repoState())
    expect(state.merging).toBe(true)

    await page.evaluate(() => (window as unknown as { api: any }).api.abortMerge())
    await page.evaluate(() => (window as unknown as { api: any }).api.checkout('main'))
    await expect.poll(() => git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
})
