import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { shell } from 'electron'

import { log } from './logger'

/**
 * Launches an external app (VS Code, Windows Terminal, Kiro, Rider, Visual Studio). Resolves as soon as the OS created the process; only a
 * spawn failure (exe missing, no permission) rejects. The launcher's exit code is NOT a result — JetBrains launchers forward the path to an
 * already-running IDE and exit with the handoff status, which is non-zero in transient states (IDE starting, updating or closing) while
 * nothing is wrong here. Whatever happens after the process exists is the OS/app's job to surface. `detached` is load-bearing: libuv puts
 * every non-detached child in a kill-on-close Windows job, so the app opened here would be terminated the moment git-cano quits. `unref()`
 * keeps the child out of the main process' event loop as well — it must outlive git-cano, not depend on it.
 */
function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: 'ignore', detached: true })
        child.once('spawn', () => {
            child.unref()
            resolve()
        })
        child.once('error', err => reject(new Error(`Failed to launch "${cmd}": ${err.message}`)))
        // Exit code is diagnostic only — never a user-facing failure (see the comment above).
        child.on('exit', (code, signal) => {
            if (code !== 0) log('warn', 'app', `"${cmd}" exited with code ${code ?? `signal ${signal}`}`)
        })
    })
}

const CODE_CLI_PATHS = [
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '/usr/local/bin/code',
    '/opt/homebrew/bin/code',
]

const CODE_EXE_PATHS = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') : '',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
].filter(Boolean)

export function openTerminal(dir: string): Promise<void> {
    if (process.platform === 'win32') {
        return runCmd('wt', ['-d', dir], dir).catch(() => runCmd('cmd.exe', [], dir))
    }
    if (process.platform !== 'darwin') {
        return Promise.reject(new Error(`Opening a terminal is not supported on ${process.platform} yet`))
    }
    return runCmd('open', ['-a', 'Terminal', dir], dir)
}

export function openFolder(dir: string): Promise<void> {
    return shell.openPath(dir).then(errorMessage => {
        if (errorMessage) throw new Error(errorMessage)
    })
}

export function openVSCode(dir: string): Promise<void> {
    for (const candidate of CODE_CLI_PATHS) {
        if (fs.existsSync(candidate)) {
            return runCmd(candidate, [dir], dir)
        }
    }
    if (process.platform === 'win32') {
        for (const candidate of CODE_EXE_PATHS) {
            if (fs.existsSync(candidate)) {
                return runCmd(candidate, [dir], dir)
            }
        }
        return Promise.reject(new Error('VS Code not found — install it or add the "code" command to PATH'))
    }
    if (process.platform === 'darwin') {
        return runCmd('open', ['-a', 'Visual Studio Code', dir], dir)
    }
    return Promise.reject(
        new Error(
            'VS Code CLI not found — install the "code" command from VS Code (Cmd/Ctrl+Shift+P → "Shell Command: Install code in PATH")'
        )
    )
}

export interface OpenInTargets {
    /** Repo contains .NET solution/project files */
    csharp: boolean
    /** Path to Kiro.exe when Kiro IDE is installed */
    kiro: string | null
    /** Path to rider64.exe when Rider is installed */
    rider: string | null
    /** Path to devenv.exe when Visual Studio with the managed-desktop workload is installed */
    visualStudio: string | null
}

function runCapture(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
        let out = ''
        child.stdout.on('data', (chunk: Buffer) => {
            out += chunk.toString()
        })
        child.on('error', err => reject(new Error(`Failed to launch "${cmd}": ${err.message}`)))
        child.on('exit', code => {
            if (code === 0) resolve(out)
            else reject(new Error(`"${cmd}" exited with code ${code}`))
        })
    })
}

const CS_SOLUTION_EXTS = new Set(['.sln', '.slnx'])
const CS_PROJECT_EXTS = new Set(['.csproj', '.fsproj', '.vbproj'])
const CS_SKIP_DIRS = new Set(['.git', '.vs', 'bin', 'obj', 'node_modules'])

function collectCsEntries(dir: string, depth: number, out: { slns: string[]; projs: string[] }): void {
    let entries: fs.Dirent[]
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return
    }
    for (const entry of entries) {
        if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            const full = path.join(dir, entry.name)
            if (CS_SOLUTION_EXTS.has(ext)) out.slns.push(full)
            else if (CS_PROJECT_EXTS.has(ext)) out.projs.push(full)
        } else if (entry.isDirectory() && depth > 0 && !CS_SKIP_DIRS.has(entry.name)) {
            collectCsEntries(path.join(dir, entry.name), depth - 1, out)
        }
    }
}

/** Returns the single .sln when there is exactly one, otherwise the repo folder. */
function csharpOpenTarget(dir: string): string {
    const out = { slns: [] as string[], projs: [] as string[] }
    collectCsEntries(dir, 3, out)
    return out.slns.length === 1 ? out.slns[0] : dir
}

function findRider(): string | null {
    if (process.platform !== 'win32') return null
    const binNames = ['rider64.exe', 'rider.exe']
    const candidates: string[] = []
    if (process.env.LOCALAPPDATA) {
        // JetBrains Toolbox layout: apps\Rider\ch-0\<version>\bin\rider64.exe
        const ch0 = path.join(process.env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-0')
        if (fs.existsSync(ch0)) {
            for (const version of fs.readdirSync(ch0)) {
                for (const bin of binNames) candidates.push(path.join(ch0, version, 'bin', bin))
            }
        }
    }
    const jbBase = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'JetBrains')
    if (fs.existsSync(jbBase)) {
        for (const entry of fs.readdirSync(jbBase)) {
            if (/^JetBrains Rider/i.test(entry)) {
                for (const bin of binNames) candidates.push(path.join(jbBase, entry, 'bin', bin))
            }
        }
    }
    return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

async function findVisualStudio(): Promise<string | null> {
    if (process.platform !== 'win32') return null
    const vswhere = path.join('C:', 'Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    if (!fs.existsSync(vswhere)) return null
    try {
        const out = await runCapture(vswhere, [
            '-all',
            '-prerelease',
            '-products',
            'Microsoft.VisualStudio.Product.Community',
            'Microsoft.VisualStudio.Product.Professional',
            'Microsoft.VisualStudio.Product.Enterprise',
            '-requires',
            'Microsoft.VisualStudio.Component.CoreEditor',
            '-format',
            'value',
            '-property',
            'installationPath',
        ])
        for (const installPath of out
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)) {
            const devenv = path.join(installPath, 'Common7', 'IDE', 'devenv.exe')
            if (fs.existsSync(devenv)) return devenv
        }
        return null
    } catch {
        return null
    }
}

export async function getOpenInTargets(dir: string): Promise<OpenInTargets> {
    const out = { slns: [] as string[], projs: [] as string[] }
    collectCsEntries(dir, 3, out)
    const csharp = out.slns.length > 0 || out.projs.length > 0
    return {
        csharp,
        kiro: findKiro(),
        rider: csharp ? findRider() : null,
        visualStudio: csharp ? await findVisualStudio() : null,
    }
}

export function openRider(dir: string): Promise<void> {
    const exe = findRider()
    if (!exe) return Promise.reject(new Error('Rider not found — install it via JetBrains Toolbox or the standalone installer'))
    return runCmd(exe, [csharpOpenTarget(dir)], dir)
}

export async function openVisualStudio(dir: string): Promise<void> {
    const devenv = await findVisualStudio()
    if (!devenv) return Promise.reject(new Error('Visual Studio not found — install Visual Studio Community, Professional, or Enterprise'))
    return runCmd(devenv, [csharpOpenTarget(dir)], dir)
}

function findKiro(): string | null {
    if (process.platform === 'win32') {
        const candidates = [
            process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Kiro', 'Kiro.exe') : '',
            'C:\\Program Files\\Kiro\\Kiro.exe',
        ].filter(Boolean)
        return candidates.find(candidate => fs.existsSync(candidate)) ?? null
    }
    if (process.platform !== 'darwin') return null
    // Kiro is a VS Code fork — its bundled CLI lives at bin/code inside the app bundle
    const candidates = [
        '/Applications/Kiro.app/Contents/Resources/app/bin/code',
        path.join(process.env.HOME ?? '', 'Applications', 'Kiro.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
    ].filter(Boolean)
    return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

export function openKiro(dir: string): Promise<void> {
    const exe = findKiro()
    if (exe) return runCmd(exe, [dir], dir)
    if (process.platform === 'darwin') {
        return runCmd('open', ['-a', 'Kiro', dir], dir)
    }
    return Promise.reject(new Error('Kiro not found — install it from kiro.dev'))
}
