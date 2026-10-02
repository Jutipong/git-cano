import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Prepares node-pty's native binary for the Electron runtime so the terminal
// works in dev and in packaged builds. Runs on postinstall and before every
// dist. Never fails the install hard: if no usable binary is available, only
// the terminal panel stays unavailable, not the rest of the app.
//
// node-pty 1.1 ships N-API prebuilds (node-addon-api). N-API binaries are
// ABI-stable across Node and Electron versions, so the prebuild for the current
// platform is used as-is and no C++ toolchain (Python + MSVC) is required. Only
// when no prebuild exists does this fall back to compiling from source against
// the Electron ABI via @electron/rebuild.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

if (hasNodePtyPrebuild()) {
    process.stdout.write(
        `[rebuild-native] using node-pty prebuilt N-API binary for ${process.platform}-${process.arch}\n`,
    )
    process.exit(0)
}

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

function hasNodePtyPrebuild() {
    const dir = join(root, 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`)
    if (!existsSync(dir)) return false
    try {
        return readdirSync(dir).some((name) => name.endsWith('.node'))
    } catch {
        return false
    }
}

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
