import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const pathTxt = join(electronDir, 'path.txt')
const platformPath = 'Electron.app/Contents/MacOS/Electron'
const executable = join(electronDir, 'dist', platformPath)

const content = existsSync(pathTxt) ? readFileSync(pathTxt, 'utf8').trim() : ''
if (content !== platformPath) {
    writeFileSync(pathTxt, platformPath)
    process.stdout.write('[fix-electron-path] repaired path.txt\n')
}

if (!existsSync(executable)) {
    process.stdout.write('[fix-electron-path] downloading Electron binary\n')
    const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
}
