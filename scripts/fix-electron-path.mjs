// Ensures node_modules/electron/path.txt exists without a trailing newline.
// (pnpm relinking can wipe it; electron v33 does not trim newlines, so we
// always write the file with printf-style exact content.)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')

if (!existsSync(pathTxt)) {
    writeFileSync(pathTxt, 'Electron.app/Contents/MacOS/Electron')
    process.stdout.write('[fix-electron-path] wrote path.txt\n')
} else {
    const content = readFileSync(pathTxt, 'utf8')
    if (content !== content.trim()) {
        writeFileSync(pathTxt, content.trim())
        process.stdout.write('[fix-electron-path] trimmed path.txt\n')
    }
}
