import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Makes sure the Electron binary exists before anything launches or packages it.
 *
 * Electron 45 ships no install script of its own (the `install-electron` bin plus the lazy download in `electron/index.js` replaced
 * it), and pnpm only runs this repo's `postinstall` on a real `install` — never on `pnpm up` / `pnpm add`. So a version bump leaves
 * the package folder without `dist/` and `path.txt`, and `dev` / e2e / `dist:*` would otherwise download ~100 MB in the middle of
 * their own run. Every script that needs the binary calls this first; it is a silent no-op once both files are in place.
 *
 * `path.txt` holds the executable path relative to `dist/` and is written by install.js for the current platform — never hard-code
 * the macOS value, or Windows sees a foreign path and install.js re-downloads the whole build.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')

function platformExecutable(platform) {
    if (platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
    if (platform === 'win32') return 'electron.exe'
    return 'electron'
}

const platformPath = platformExecutable(process.platform)
const executable = join(electronDir, 'dist', platformPath)

if (!existsSync(executable)) {
    const installer = join(electronDir, 'install.js')
    if (!existsSync(installer)) {
        process.stderr.write('[fix-electron-path] node_modules/electron is missing — run pnpm install\n')
        process.exit(1)
    }
    process.stdout.write('[fix-electron-path] downloading Electron binary\n')
    // install.js writes path.txt itself and exits early when the build is already in place.
    const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
    process.exit(0)
}

// Older installs could leave path.txt missing or pointing at another platform's executable.
const content = existsSync(pathTxt) ? readFileSync(pathTxt, 'utf8').trim() : ''
if (content !== platformPath) {
    writeFileSync(pathTxt, platformPath)
    process.stdout.write('[fix-electron-path] repaired path.txt\n')
}
