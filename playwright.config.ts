import * as os from 'node:os'
import * as path from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    forbidOnly: !!process.env.CI,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    outputDir: process.env.GITCANO_E2E_ARTIFACTS ?? path.join(os.tmpdir(), 'git-cano-e2e-artifacts'),
    globalSetup: './tests/e2e/global-setup.ts',
    use: {
        screenshot: 'only-on-failure',
        trace: 'off',
        video: 'off',
    },
})
