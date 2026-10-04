import * as fs from 'node:fs'
import * as path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.stashRepo])
    page = handle.page
    await expect(page.locator('.graph-row').first()).toBeVisible()
})

test.afterAll(async () => {
    await handle?.app.close()
})

test('stash: create, apply and drop', async () => {
    fs.writeFileSync(path.join(fx.stashRepo, 'work.txt'), 'changed\n')
    await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        await api.createStash('e2e stash')
    })
    const stashes = await page.evaluate(() => {
        const api = (window as unknown as { api: any }).api
        return api.stashes()
    })
    expect(stashes).toHaveLength(1)
    expect(stashes[0].message).toContain('e2e stash')
    expect(fs.readFileSync(path.join(fx.stashRepo, 'work.txt'), 'utf8')).toBe('base\n')

    await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        await api.applyStash(0, true)
    })
    expect(fs.readFileSync(path.join(fx.stashRepo, 'work.txt'), 'utf8')).toBe('changed\n')
    const afterPop = await page.evaluate(() => {
        const api = (window as unknown as { api: any }).api
        return api.stashes()
    })
    expect(afterPop).toHaveLength(0)
})

test('tag: create and delete', async () => {
    await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        await api.createTag('e2e-tag', null)
    })
    const tags = await page.evaluate(() => {
        const api = (window as unknown as { api: any }).api
        return api.tags()
    })
    expect(tags.some((tag: { name: string }) => tag.name === 'e2e-tag')).toBe(true)

    await page.evaluate(async () => {
        const api = (window as unknown as { api: any }).api
        await api.deleteTag('e2e-tag')
    })
    const afterDelete = await page.evaluate(() => {
        const api = (window as unknown as { api: any }).api
        return api.tags()
    })
    expect(afterDelete).toHaveLength(0)
})
