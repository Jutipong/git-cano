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
    return execFileSync('git', args, { cwd: fx.opsRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function subjects(): string[] {
    return git(['log', '--format=%s']).split('\n').filter(Boolean)
}

function cleanTree(): void {
    git(['reset', '--hard', 'HEAD'])
    git(['clean', '-fd'])
}

test.beforeAll(async () => {
    handle = await launchApp([fx.opsRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
    // palette/terminal/workspace treat ops-repo as the shared clean fixture, but undo of the revert
    // above is a soft reset — the reverted deletions stay staged. Put the repo back clean for them.
    cleanTree()
})

test('undo: a commit is journaled and undo restores HEAD', async () => {
    fs.writeFileSync(path.join(fx.opsRepo, 'file-5.txt'), 'changed\n')
    const result = await page.evaluate(async (repo: string) => {
        const api = (window as unknown as { api: any }).api
        await api.stageAll(repo)
        await api.commitWithAmend('test: undo target', false, repo)
        const peek = await api.undoPeek(repo)
        const after = await api.undoById(peek.id, repo)
        return { peek, after }
    }, fx.opsRepo)
    expect(result.peek?.label).toContain('commit')
    expect(git(['log', '-1', '--format=%s'])).toBe('chore: commit 5')
    // The soft-reset undo keeps the change around, so the tree is dirty afterwards.
    expect(git(['status', '--porcelain'])).toContain('file-5.txt')
    cleanTree()
})

test('squash: a HEAD range collapses into one commit', async () => {
    const target = git(['rev-parse', 'HEAD~2'])
    const plan = await page.evaluate(async ({ target }: { target: string }) => {
        const api = (window as unknown as { api: any }).api
        const squashPlan = await api.squashPlan(target)
        await api.squashCommits(squashPlan.base, 'chore: squashed range')
        return squashPlan
    }, { target })
    expect(plan.commits).toHaveLength(3)
    expect(subjects()).toEqual(['chore: squashed range', 'chore: commit 2', 'chore: commit 1'])
})

test('interactive rebase: dropping a commit works and reflog restores it', async () => {
    const before = subjects()
    const preHead = git(['rev-parse', 'HEAD'])
    const plan = await page.evaluate((repo: string) => {
        const api = (window as unknown as { api: any }).api
        return api.rebasePlan('HEAD~2', repo)
    }, fx.opsRepo)
    expect(plan).toHaveLength(2)

    const outcome = await page.evaluate(
        ({ repo, entries }: { repo: string; entries: { command: string; hash: string }[] }) => {
            const api = (window as unknown as { api: any }).api
            return api.rebaseStart('HEAD~2', entries, repo)
        },
        {
            repo: fx.opsRepo,
            entries: [
                { command: 'drop', hash: plan[0].hash },
                { command: 'pick', hash: plan[1].hash },
            ],
        }
    )
    expect(outcome.completed).toBe(true)
    expect(subjects()).toEqual(['chore: squashed range', 'chore: commit 1'])

    const reflog = await page.evaluate(() => {
        const api = (window as unknown as { api: any }).api
        return api.reflog(20)
    })
    // Restore the exact pre-rebase tip (HEAD@{n} indices shift around during a rebase, the hash does not).
    const restoreTarget = reflog.find((entry: { hash: string }) => entry.hash === preHead)
    expect(restoreTarget).toBeTruthy()
    await page.evaluate((hash: string) => {
        const api = (window as unknown as { api: any }).api
        return api.restoreReflog(hash)
    }, restoreTarget.hash)
    expect(subjects()).toEqual(before)
})

test('revert: appends a revert commit and journals undo', async () => {
    const head = git(['rev-parse', 'HEAD'])
    const peek = await page.evaluate(async ({ repo, hash }: { repo: string; hash: string }) => {
        const api = (window as unknown as { api: any }).api
        await api.revertCommit(hash)
        const preview = await api.undoPeek(repo)
        await api.undoById(preview.id, repo)
        return preview
    }, { repo: fx.opsRepo, hash: head })
    expect(peek?.label).toContain('revert')
    expect(git(['rev-parse', 'HEAD'])).toBe(head)
})
