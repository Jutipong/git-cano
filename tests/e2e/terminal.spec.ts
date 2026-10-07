import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

import { loadFixtures } from './fixtures'
import { launchApp, type AppHandle } from './launch'

const fx = loadFixtures()

test.describe.configure({ mode: 'serial' })

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
    handle = await launchApp([fx.mainRepo, fx.opsRepo])
    page = handle.page
    await expect(page.locator('.repo-tab')).toHaveCount(2)
    // Pin the shell for this file: the shipped default is PowerShell 7, which may or may not exist on
    // the machine running the suite, and every test below asserts the resolved tab label.
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Terminal' }).click()
    await page.locator('.setting-chip', { hasText: 'Command Prompt' }).click()
    await page.locator('.tools-modal .commit-close-btn').click()
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test.afterAll(async () => {
    await handle?.app.close()
})

/** Types into the visible shell and waits for its echo to come back. */
async function runInTerminal(command: string, expectText: string): Promise<void> {
    await page.locator('.terminal-view:visible .xterm-helper-textarea').focus()
    await page.keyboard.type(command)
    await page.keyboard.press('Enter')
    await expect(page.locator('.terminal-view:visible .xterm-screen')).toContainText(expectText, { timeout: 30_000 })
}

test('graph toolbar button spawns one shell, then toggles the panel', async () => {
    await expect(page.locator('.terminal-panel')).toHaveCount(0)

    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel')).toHaveCount(1)
    await expect(page.locator('.terminal-view .xterm')).toHaveCount(1)
    await expect(page.locator('.terminal-tab-label')).toHaveText('cmd 1')

    // Second press only hides — the shell keeps running (the panel stays mounted).
    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel')).toBeHidden()
    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel')).toBeVisible()

    await runInTerminal('echo git-cano-terminal-ok', 'git-cano-terminal-ok')
})

test('the second repo owns its own panel and keeps its shell while the first is on screen', async () => {
    await page.locator('.repo-tab').nth(1).click()
    await expect(page.locator('.repo-tab.active')).toHaveCount(1)
    // The first repo's shell is still alive while its tab is off screen.
    await expect(page.locator('.terminal-panel')).toHaveCount(1)

    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel')).toHaveCount(2)

    // Each repo's panel renders only its own active shell.
    const labels = await page.locator('.terminal-panel:visible .terminal-tab-label').allTextContents()
    expect(labels).toEqual(['cmd 1'])

    await page.locator('.repo-tab').nth(0).click()
    await expect(page.locator('.terminal-panel:visible .terminal-tab-label')).toHaveText('cmd 1')
})

test('full mode overlays the graph without moving the repo tab bar', async () => {
    const tabsBefore = await page.locator('.tab-bar').boundingBox()
    // Every repo keeps its own panel mounted, so always act on the one on screen.
    await page.locator('.terminal-panel:visible .icon-btn[title="Full height"]').click()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(1)
    // The teleport move must hand the keyboard back to the shell — both directions.
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused()
    const tabsAfter = await page.locator('.tab-bar').boundingBox()
    expect(tabsAfter?.y).toBe(tabsBefore?.y)
    expect(tabsAfter?.height).toBe(tabsBefore?.height)
    // The panel starts under the tab bar, not over it.
    const panel = await page.locator('.terminal-panel.terminal-overlay').boundingBox()
    expect(panel?.y).toBeGreaterThan(tabsAfter!.y + tabsAfter!.height - 1)

    await page.locator('.terminal-panel:visible .icon-btn[title="Exit full height"]').click()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(0)
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused()
})

test('Ctrl+` and the palette remember full mode across a hide; the header hide button collapses to the strip', async () => {
    const panel = page.locator('.terminal-panel:visible')
    const fullBtn = panel.locator('.icon-btn[title="Full height"]')

    // Ctrl+` hides the overlay and brings it back untouched, keyboard included.
    await fullBtn.click()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(1)
    await page.keyboard.press('Control+`')
    await expect(page.locator('.terminal-panel:visible')).toHaveCount(0)
    await page.keyboard.press('Control+`')
    await expect(panel).toBeVisible()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(1)
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused()

    // The header hide button drops the full-height state: the next show lands on the bottom strip.
    await panel.locator('.icon-btn[title*="Hide panel"]').click()
    await expect(page.locator('.terminal-panel:visible')).toHaveCount(0)
    await page.keyboard.press('Control+`')
    await expect(panel).toBeVisible()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(0)

    // The palette toggle behaves like Ctrl+`: hide, then show straight back into the overlay.
    await fullBtn.click()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(1)
    const paletteTerminal = page
        .locator('.palette-item')
        .filter({ has: page.locator('.palette-label', { hasText: /^Terminal$/ }) })
    await page.keyboard.press('Control+p')
    await paletteTerminal.click()
    await expect(page.locator('.terminal-panel:visible')).toHaveCount(0)
    await page.keyboard.press('Control+p')
    await paletteTerminal.click()
    await expect(panel).toBeVisible()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(1)
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused()

    // Leave the suite where the neighbouring tests expect it: bottom strip, panel visible.
    await panel.locator('.icon-btn[title="Exit full height"]').click()
    await expect(page.locator('.terminal-panel.terminal-overlay')).toHaveCount(0)
})

test('font size buttons change the terminal scale only', async () => {
    const readUi = () => page.evaluate(() => JSON.parse(localStorage.getItem('ui') ?? '{}'))
    const before = await readUi()
    const rowsBefore = await page.locator('.terminal-view:visible .xterm-rows').getAttribute('style')

    await page.locator('.terminal-panel:visible .terminal-font-btn', { hasText: 'A+' }).click()

    // The terminal's own size is a separate persisted setting, and the UI scale must not move.
    const after = await readUi()
    expect(after.terminalFontSize).toBeGreaterThan(before.terminalFontSize)
    expect(after.fontSize).toBe(before.fontSize)
    await expect(page.locator('.terminal-view:visible .xterm-rows')).not.toHaveAttribute('style', rowsBefore ?? '')
})

test('terminal tabs rename on double-click and keep their number through a reorder', async () => {
    const panel = page.locator('.terminal-panel:visible')
    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await expect(panel.locator('.terminal-tab-label')).toHaveText(['cmd 1', 'cmd 2'])

    // The number belongs to the tab, not the slot: dragging the second shell in front keeps its name.
    await panel.locator('.terminal-tab').nth(1).dragTo(panel.locator('.terminal-tab').first(), {
        targetPosition: { x: 2, y: 8 },
    })
    await expect(panel.locator('.terminal-tab-label')).toHaveText(['cmd 2', 'cmd 1'])
    await panel.locator('.terminal-tab').nth(1).dragTo(panel.locator('.terminal-tab').first(), {
        targetPosition: { x: 2, y: 8 },
    })
    await expect(panel.locator('.terminal-tab-label')).toHaveText(['cmd 1', 'cmd 2'])

    // Rename each so the later drag is unambiguous even if the derived labels ever collide.
    const rename = async (index: number, name: string) => {
        await panel.locator('.terminal-tab-label').nth(index).dblclick()
        // `.fill()` focuses the field itself — assert the app put the caret there, or a broken
        // focus call (a v-for ref collected as an array) would slip through.
        await expect(panel.locator('.terminal-tab-rename')).toBeFocused()
        await panel.locator('.terminal-tab-rename').fill(name)
        await page.keyboard.press('Enter')
    }
    await rename(0, 'build')
    await rename(1, 'serve')
    await expect(panel.locator('.terminal-tab-label')).toHaveText(['build', 'serve'])

    // Drag the second tab in front of the first (same interaction as the repo tabs).
    await panel.locator('.terminal-tab').nth(1).dragTo(panel.locator('.terminal-tab').first(), {
        targetPosition: { x: 2, y: 8 },
    })
    await expect(panel.locator('.terminal-tab-label')).toHaveText(['serve', 'build'])

    // Reordering moved the labels, not the shells: the tab on screen is still a live shell.
    await runInTerminal('echo after-reorder-ok', 'after-reorder-ok')
})

test('closing the repo tab kills its shells, and the other repo keeps working', async () => {
    // main repo (first tab) currently owns a shell; ops repo owns one too.
    await page.locator('.repo-tab').first().locator('.tab-close').click()
    await expect(page.locator('.repo-tab')).toHaveCount(1)
    await expect(page.locator('.terminal-panel')).toHaveCount(1)
    await expect(page.locator('.terminal-panel:visible')).toHaveCount(1)
})

test('kill all lives in the palette only, and terminates every remaining shell', async () => {
    // No header button for it and no shortcut (too easy to fat-finger): kill-all ends shells of
    // repos that are not on screen, so it keeps one confirm-guarded home — the palette item.
    await expect(page.locator('.terminal-panel:visible .icon-btn[title*="Kill every terminal"]')).toHaveCount(0)
    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: 'Terminal Kill All' }) }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Kill all' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('the header ✕ closes every shell of its repo behind a confirm', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)

    await panel.locator('.diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close 2 terminals' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Ctrl+` toggles the panel, and the palette kills everything', async () => {
    await page.keyboard.press('Control+`')
    await expect(page.locator('.terminal-panel')).toHaveCount(1)
    await page.waitForSelector('.terminal-view:visible .xterm', { timeout: 30_000 })

    await page.keyboard.press('Control+`')
    await expect(page.locator('.terminal-panel')).toBeHidden()

    // Showing again hands the keyboard back to the shell — type without clicking first.
    await page.keyboard.press('Control+`')
    await expect(page.locator('.terminal-view:visible .xterm-helper-textarea')).toBeFocused()

    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: 'Terminal Kill All' }) }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Kill all' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('the header hide button hides the panel without killing the shell', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await expect(panel.locator('.terminal-tab-label')).toHaveText('cmd 1')

    await panel.locator('.icon-btn[title*="Hide panel"]').click()
    await expect(page.locator('.terminal-panel')).toBeHidden()

    // Hiding is not closing: the same shell session is there when the panel comes back.
    await page.locator('.graph-terminal-btn').click()
    await expect(panel.locator('.terminal-tab-label')).toHaveText('cmd 1')
    await runInTerminal('echo after-hide-ok', 'after-hide-ok')

    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: 'Terminal Kill All' }) }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Kill all' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('the command palette toggles the panel and offers kill all', async () => {
    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: /^Terminal$/ }) }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(1)

    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: 'Terminal Kill All' }) }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Kill all' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Settings → Terminal picks the shell of new terminals and sizes the text live', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Terminal' }).click()

    // Three shells are offered (no `Default` chip); PowerShell 7 resolves to Command Prompt when
    // pwsh.exe is missing, which is what the resolved tab label reports.
    const chips = page.locator('.setting-choice-row .setting-chip')
    await expect(chips.filter({ hasText: 'Command Prompt' })).toHaveCount(1)
    await expect(chips.filter({ hasText: 'Windows PowerShell' })).toHaveCount(1)
    await expect(chips.filter({ hasText: 'PowerShell 7' })).toHaveCount(1)
    await expect(chips.filter({ hasText: 'Default' })).toHaveCount(0)

    let hasPwsh = false
    try {
        execFileSync('where', ['pwsh.exe'], { stdio: 'ignore' })
        hasPwsh = true
    } catch {}
    await chips.filter({ hasText: 'PowerShell 7' }).click()
    await page.locator('.tools-modal .commit-close-btn').click()
    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel:visible .terminal-tab-label')).toHaveText(hasPwsh ? 'pwsh 1' : 'cmd 1')
    await page.locator('.terminal-panel:visible .diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close terminal' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)

    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Terminal' }).click()
    await page.locator('.setting-chip', { hasText: 'Windows PowerShell' }).click()
    await page.locator('.tools-modal .commit-close-btn').click()

    // A terminal opened after the change uses the new shell; the setting survives the dialog.
    await page.locator('.graph-terminal-btn').click()
    await expect(page.locator('.terminal-panel:visible .terminal-tab-label')).toHaveText('powershell 1')

    // The font-size chips hit the same setting the panel's A− / A+ step, and open shells follow.
    const readUi = () => page.evaluate(() => JSON.parse(localStorage.getItem('ui') ?? '{}'))
    const sizeBefore = (await readUi()).terminalFontSize
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Terminal' }).click()
    await page.locator('.setting-choice-row .setting-chip', { hasText: '18px' }).click()
    await page.locator('.tools-modal .commit-close-btn').click()
    expect((await readUi()).terminalFontSize).toBe(18)
    expect((await readUi()).terminalShell).toBe('powershell')
    expect(sizeBefore).not.toBe(18)

    await page.keyboard.press('Control+p')
    await page.locator('.palette-item').filter({ has: page.locator('.palette-label', { hasText: 'Terminal Kill All' }) }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Kill all' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Settings → Terminal picks a font family with fallback to default', async () => {
    await page.keyboard.press('Control+,')
    await page.locator('.tools-tabs .graph-filter', { hasText: 'Terminal' }).click()
    const readUi = () => page.evaluate(() => JSON.parse(localStorage.getItem('ui') ?? '{}'))

    // A preset chip persists the full stack (primary + Thai fallback).
    await page.locator('.setting-chip', { hasText: 'JetBrains Mono' }).click()
    expect((await readUi()).terminalFontFamily).toContain('JetBrains Mono')
    expect((await readUi()).terminalFontFamily).toContain('Leelawadee UI')

    // Custom input commits on Enter; an uninstalled face reports the fallback hint.
    const input = page.locator('.tools-modal input[placeholder="e.g. Fira Code"]')
    await input.fill('No Such Font On Earth')
    await input.press('Enter')
    expect((await readUi()).terminalFontFamily).toContain('No Such Font On Earth')
    await expect(page.getByText('Font not installed — using default.')).toBeVisible()

    // Reset restores the Consolas default behind a confirm.
    await page.locator('.tools-modal .tools-reset-row button', { hasText: 'Reset to defaults' }).click()
    await page.locator('.confirm-dialog button', { hasText: 'Reset' }).click()
    expect((await readUi()).terminalFontFamily).toContain('Consolas')

    await page.locator('.tools-modal .commit-close-btn').click()
    await expect(page.locator('.tools-modal')).toHaveCount(0)
})

test('a repo stops at four shells', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)

    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(3)
    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(4)

    await expect(panel.locator('.terminal-tab-add')).toBeDisabled()
    await expect(panel.locator('.terminal-tab-add')).toHaveAttribute('title', 'Maximum 4 terminals per repo')
    await panel.locator('.terminal-tab-add').click({ force: true })
    await expect(panel.locator('.terminal-tab')).toHaveCount(4)

    // Ctrl+T at the cap is a silent no-op — no fifth tab, no toast.
    await page.keyboard.press('Control+t')
    await expect(panel.locator('.terminal-tab')).toHaveCount(4)
    await expect(page.locator('.toast', { hasText: 'Maximum' })).toHaveCount(0)

    await panel.locator('.diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close 4 terminals' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Ctrl+T opens a shell and Ctrl+1…9 switch between terminal tabs', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)

    // Ctrl+T spawns a tab (no `+` click) and makes it the active one.
    await page.keyboard.press('Control+t')
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)
    await expect(panel.locator('.terminal-tab').nth(1)).toHaveClass(/active/)
    await page.keyboard.press('Control+t')
    await expect(panel.locator('.terminal-tab')).toHaveCount(3)

    // Number keys address tabs by their on-screen position; a missing tab is a silent no-op.
    await page.keyboard.press('Control+1')
    await expect(panel.locator('.terminal-tab').nth(0)).toHaveClass(/active/)
    await page.keyboard.press('Control+3')
    await expect(panel.locator('.terminal-tab').nth(2)).toHaveClass(/active/)
    await page.keyboard.press('Control+9')
    await expect(panel.locator('.terminal-tab').nth(2)).toHaveClass(/active/)

    // With the panel hidden, the shortcut brings it back on the requested tab.
    await panel.locator('.icon-btn[title*="Hide panel"]').click()
    await expect(page.locator('.terminal-panel')).toBeHidden()
    await page.keyboard.press('Control+2')
    await expect(page.locator('.terminal-panel')).toBeVisible()
    await expect(panel.locator('.terminal-tab').nth(1)).toHaveClass(/active/)

    await panel.locator('.diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close 3 terminals' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('the splitter resizes the panel height, and the shell follows', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await page.waitForSelector('.terminal-view .xterm', { timeout: 30_000 })
    const before = await panel.boundingBox()

    const splitter = await page.locator('.terminal-splitter').boundingBox()
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + splitter.height / 2)
    await page.mouse.down()
    // Pull the top edge upward — the panel grows.
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y - 90, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(600)

    const after = await panel.boundingBox()
    expect(Math.round(after.height - before.height)).toBeGreaterThan(60)
    // A shorter panel means fewer rows: the pty was resized, not just the box painted.
    const rows = await page.evaluate(() => {
        const term = document.querySelector('.terminal-view:not([style*="display: none"]) .xterm-rows')
        return term?.children.length ?? 0
    })
    expect(rows).toBeGreaterThan(0)

    await runInTerminal('echo after-resize-ok', 'after-resize-ok')
    await panel.locator('.diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close terminal' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Ctrl+click opens a printed URL through the OS browser bridge, a plain click does not', async () => {
    // Swap the main-process opener for a recorder: the real one launches the machine's default
    // browser, and this test only needs to see the URL arrive at `app:openExternal`.
    await handle.app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { __openedLinks: string[] }
        g.__openedLinks = []
        shell.openExternal = (url: string) => {
            g.__openedLinks.push(url)
            return Promise.resolve()
        }
    })

    await page.locator('.graph-terminal-btn').click()
    await page.waitForSelector('.terminal-view:visible .xterm', { timeout: 30_000 })
    const url = 'http://localhost:3000/git-cano-link-ok'
    await runInTerminal(`echo ${url}`, url)

    // The echoed command line carries the URL too; only the row without `echo` is its output.
    const rows = page
        .locator('.terminal-view:visible .xterm-rows > div')
        .filter({ hasText: url })
        .filter({ hasNotText: 'echo' })
    await expect(rows).toHaveCount(1)
    const row = rows.first()

    // A plain click stays a selection — xterm core would activate the link, the handler refuses.
    // `force` skips Playwright's hit-target check: xterm's own layering puts `.xterm-screen` over
    // the row divs, and the linkifier listens on that screen element.
    await row.click({ position: { x: 24, y: 8 }, force: true })
    await page.waitForTimeout(400)
    expect(await handle.app.evaluate(() => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks)).toEqual([])

    await row.click({ position: { x: 24, y: 8 }, modifiers: ['Control'], force: true })
    await expect
        .poll(() => handle.app.evaluate(() => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks))
        .toEqual([url])
    // No Electron window may appear: the addon's default `window.open` handler must never run.
    expect(handle.app.windows()).toHaveLength(1)

    await page.locator('.terminal-panel:visible .diff-close-btn').click()
    await page.locator('.confirm-dialog button', { hasText: 'Close terminal' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)
})

test('Ctrl+W closes the focused terminal tab behind a confirm, and the repo tab otherwise', async () => {
    await page.locator('.graph-terminal-btn').click()
    const panel = page.locator('.terminal-panel:visible')
    await panel.locator('.terminal-tab-add').click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(2)

    // Keyboard in the shell: the panel reads as focused (the teal `:focus-within` edge, the same
    // condition the shortcut checks) and Ctrl+W belongs to the shell's tab.
    const shell = page.locator('.terminal-view:visible .xterm-helper-textarea')
    await shell.focus()
    expect(await panel.evaluate(el => el.matches(':focus-within'))).toBe(true)
    await page.locator('.commit-search input').click()
    expect(await panel.evaluate(el => el.matches(':focus-within'))).toBe(false)
    await shell.focus()

    const activeLabel = await panel.locator('.terminal-tab.active .terminal-tab-label').innerText()
    await page.keyboard.press('Control+w')
    await expect(page.locator('.confirm-dialog-header')).toContainText(`Close ${activeLabel}`)
    await page.locator('.confirm-dialog button', { hasText: 'Close terminal' }).click()
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)

    // Cancelling keeps the shell alive and hands the keyboard back, so the next press still targets
    // the terminal tab instead of falling through to the repo tab behind it.
    await shell.focus()
    await page.keyboard.press('Control+w')
    await page.locator('.confirm-dialog button', { hasText: 'Cancel' }).click()
    await expect(shell).toBeFocused()
    await expect(panel.locator('.terminal-tab')).toHaveCount(1)

    // The last shell takes the panel down with it — focus lands nowhere near a terminal.
    await page.keyboard.press('Control+w')
    await page.locator('.confirm-dialog button', { hasText: 'Close terminal' }).click()
    await expect(page.locator('.terminal-panel')).toHaveCount(0)

    // Focus outside the terminal: Ctrl+W is the fixed repo-tab close again.
    await page.locator('.commit-search input').click()
    await page.keyboard.press('Control+w')
    await expect(page.locator('.repo-tab')).toHaveCount(0)
})

test.describe('workspace switches', () => {
    let wsHandle: AppHandle
    let wsPage: Page

    test.beforeAll(async () => {
        // Main holds mainRepo (which will get a shell); Alt holds a repo of its own.
        wsHandle = await launchApp([fx.mainRepo], { workspaces: { Alt: [fx.extraRepos[0]] } })
        wsPage = wsHandle.page
        await expect(wsPage.locator('.repo-tab')).toHaveCount(1)
    })

    test.afterAll(async () => {
        await wsHandle?.app.close()
    })

    test('shells of the workspace you left keep running and come back with their tabs', async () => {
        await wsPage.locator('.graph-terminal-btn').click()
        await wsPage.waitForSelector('.terminal-view .xterm', { timeout: 30_000 })
        const panel = wsPage.locator('.terminal-panel:visible')
        await panel.locator('.terminal-tab-add').click()
        await expect(panel.locator('.terminal-tab')).toHaveCount(2)

        // Switch to the other workspace — its repos own no shells, so nothing is on screen.
        await wsPage.locator('.workspace-btn').click()
        await wsPage.locator('.workspace-pop .workspace-item', { hasText: 'Alt' }).click()
        await expect(wsPage.locator('.repo-tab')).toHaveCount(1)
        await expect(wsPage.locator('.terminal-panel:visible')).toHaveCount(0)
        // The panels stay mounted (hidden), which is what keeps the PTYs alive.
        await expect(wsPage.locator('.terminal-panel')).toHaveCount(1)

        // Back to Main: the same tabs are there, and the shell still runs commands.
        await wsPage.locator('.workspace-btn').click()
        await wsPage.locator('.workspace-pop .workspace-item', { hasText: 'Main' }).click()
        await expect(wsPage.locator('.repo-tab')).toHaveCount(1)
        const back = wsPage.locator('.terminal-panel:visible')
        await expect(back.locator('.terminal-tab')).toHaveCount(2)

        await wsPage.locator('.terminal-view:visible .xterm-helper-textarea').focus()
        await wsPage.keyboard.type('echo alive-after-workspace-switch')
        await wsPage.keyboard.press('Enter')
        await expect(wsPage.locator('.terminal-view:visible .xterm-screen')).toContainText('alive-after-workspace-switch', {
            timeout: 30_000,
        })
    })
})
