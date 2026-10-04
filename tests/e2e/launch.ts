import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface AppHandle {
    app: ElectronApplication
    page: Page
    /** Isolated Electron userData dir (settings/recent/localStorage live here). */
    userData: string
}

export interface LaunchOptions {
    /** Directory containing the built app (package.json + out/). Defaults to the repo root. */
    appDir?: string
    /** Set false for older builds that cannot survive a `GIT_CANO_LOG_LEVEL` env (pre baseEnv fix). */
    debugLog?: boolean
    /** Extra Electron args (e.g. `--js-flags=--expose-gc` for benchmarks). */
    extraArgs?: string[]
    /**
     * Additional workspace sessions to seed alongside `Main` (which always gets `repoPaths`), e.g.
     * `{ Alt: [pathA, pathB] }` — every workspace's first repo is its active tab.
     */
    workspaces?: Record<string, string[]>
}

/**
 * Launches the built app (out/) with an isolated userData dir and seeds the workspace session so every
 * fixture repo opens as a tab. Isolation relies on Chromium's `--user-data-dir` switch (Electron maps both
 * `userData` and `sessionData` to it), so the real user profile is never touched.
 */
export async function launchApp(repoPaths: string[], options: LaunchOptions = {}): Promise<AppHandle> {
    const { appDir = '.', debugLog = true, extraArgs = [], workspaces = {} } = options
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cano-e2e-userdata-'))
    fs.writeFileSync(path.join(userData, 'recent.json'), JSON.stringify(repoPaths))
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
    }
    if (debugLog) env.GIT_CANO_LOG_LEVEL = 'debug'
    delete env.ELECTRON_RENDERER_URL
    delete env.ELECTRON_RUN_AS_NODE

    const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...extraArgs], cwd: appDir, env })
    const page = await app.firstWindow()

    // Runs on the reload below, before the app scripts: seed the workspace session and spy on
    // URL.revokeObjectURL so the image-diff cleanup can be asserted.
    await page.addInitScript(
        ({ paths, extraWorkspaces }: { paths: string[]; extraWorkspaces: Record<string, string[]> }) => {
            const names = ['Main']
            const sessions: Record<string, { paths: string[]; active: number }> = { Main: { paths, active: 0 } }
            for (const [name, workspacePaths] of Object.entries(extraWorkspaces)) {
                names.push(name)
                sessions[name] = { paths: workspacePaths, active: 0 }
            }
            localStorage.setItem('workspace', JSON.stringify({ names, active: 'Main', sessions }))
            const w = window as unknown as { __revokes: number }
            w.__revokes = 0
            const original = URL.revokeObjectURL.bind(URL)
            URL.revokeObjectURL = (url: string) => {
                w.__revokes++
                return original(url)
            }
        },
        { paths: repoPaths, extraWorkspaces: workspaces }
    )
    await page.reload()

    await page.waitForSelector('.repo-tab, .app-empty', { timeout: 60_000 })
    return { app, page, userData }
}
