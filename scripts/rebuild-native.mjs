import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Rebuilds native modules (currently node-pty) against the Electron ABI so the
// terminal works in dev and in packaged builds. Runs on postinstall and before
// every dist. Never fails the install hard: a missing toolchain only means the
// terminal panel stays unavailable, not that git operations break.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronVersion = getElectronVersion()
if (!electronVersion) {
    process.stdout.write('[rebuild-native] Electron version not found — skipping\n')
    process.exit(0)
}

const cli = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const result = spawnSync(process.execPath, [cli, '-v', electronVersion, '-f', '-m', 'node_modules/node-pty'], {
    stdio: 'inherit',
    cwd: root,
})

if (result.error || result.status !== 0) {
    process.stdout.write('[rebuild-native] node-pty rebuild failed — terminal panel will be unavailable\n')
    process.exit(0)
}
process.stdout.write(`[rebuild-native] node-pty rebuilt for Electron ${electronVersion}\n`)

function getElectronVersion() {
    try {
        const out = spawnSync(process.execPath, ['-e', "process.stdout.write(require('electron/package.json').version)"], {
            cwd: root,
            encoding: 'utf8',
        }).stdout
        const version = String(out).trim()
        return version || null
    } catch {
        return null
    }
}
