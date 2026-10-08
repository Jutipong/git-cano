import * as fs from 'node:fs'
import * as path from 'node:path'

import { log } from './logger'

import type { TerminalData, TerminalExit, TerminalShell } from '@shared/types'
import { mergePathValue, pathKeyFor } from '@shared/terminalPath'
import type { IPty } from 'node-pty'

type PtyModule = { spawn: (file: string, args: string[] | string, options: unknown) => IPty }

/** One interactive shell per terminal tab — a repo can hold several, so sessions are keyed by id. */
interface TerminalSession {
    id: string
    repoPath: string
    pty: IPty
    cols: number
    rows: number
}

const sessions = new Map<string, TerminalSession>()

/** Callbacks wired from index.ts to push output/exit to the renderer window. */
let onData: ((payload: TerminalData) => void) | null = null
let onExit: ((payload: TerminalExit) => void) | null = null

export function onTerminalData(callback: (payload: TerminalData) => void): void {
    onData = callback
}

export function onTerminalExit(callback: (payload: TerminalExit) => void): void {
    onExit = callback
}

/**
 * node-pty is a native module that may be missing or built for the wrong ABI on a dev machine.
 * Load it lazily so the rest of the app keeps working and the terminal surfaces a clear error
 * instead of crashing at import time.
 */
function loadPty(): PtyModule {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('node-pty') as PtyModule
    } catch (error) {
        throw new Error(`Terminal is unavailable — native module node-pty could not be loaded (${String(error)})`)
    }
}

/**
 * ConPTY opens its pseudo-console with codepage 437, which turns every Thai byte a program writes
 * into mojibake (`echo ทดสอบ` from a redirecting command). Forcing UTF-8 as the shell's first action
 * fixes raw-byte output (`type`, `git log`, ...) — Node-based CLIs already write UTF-8 themselves.
 */
const POWER_SHELL_ARGS = ['-NoExit', '-Command', 'chcp 65001 > $null; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)']

/** Cached result of the once-per-run PATH scan for pwsh.exe. */
let pwshInstalled: boolean | null = null

/**
 * True when the candidate exists as a shell executable — a plain file (MSI install) or a
 * Store/MSIX app-execution alias. fs.existsSync follows reparse points, and the WindowsApps
 * `pwsh.exe` alias resolves into the locked package folder, so stat fails with EACCES and the
 * alias looks missing. lstat reads the alias itself (libuv reports it as a symlink), and Windows
 * resolves the alias again when the shell is spawned — so both install flavours must match here.
 */
function shellFileExists(candidate: string): boolean {
    try {
        const stat = fs.lstatSync(candidate)
        return stat.isFile() || stat.isSymbolicLink()
    } catch {
        return false
    }
}

/**
 * True when pwsh.exe is on PATH. PowerShell 7 is an optional install, and the settings default is
 * "PowerShell 7", so this decides whether that default is honoured or falls back to Command Prompt.
 * Both install flavours count — MSI (real file) and Store/MSIX (WindowsApps alias) — and no
 * subprocess is spawned: the PATH scan is cached for the session. Reads PATH case-insensitively:
 * on Windows Electron exposes it as `Path`, so `process.env.PATH` alone is usually undefined.
 */
function currentProcessPath(): string {
    const key = Object.keys(process.env).find(candidate => candidate.toLowerCase() === 'path')
    const value = key ? process.env[key] : undefined
    return typeof value === 'string' ? value : ''
}

function hasPwsh(): boolean {
    if (pwshInstalled !== null) return pwshInstalled
    const exts = (process.env.PATHEXT || '.EXE').split(';').filter(Boolean)
    pwshInstalled = currentProcessPath()
        .split(path.delimiter)
        .some(dir => {
            if (!dir) return false
            return exts.some(ext => {
                const candidates = [path.join(dir, `pwsh${ext.toLowerCase()}`), path.join(dir, `pwsh${ext}`)]
                return candidates.some(candidate => shellFileExists(candidate))
            })
        })
    return pwshInstalled
}

/**
 * True when the directory exists. Guards the PATH augmentation below: only real user-bin dirs
 * are prepended, so a missing install never pollutes the shell's PATH.
 */
function dirExists(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isDirectory()
    } catch {
        return false
    }
}

/**
 * User-level bin dirs a GUI launch typically misses. An Explorer/Start-menu launch inherits the
 * registry PATH snapshot from login time, while an interactive shell picks up per-shell additions
 * (npm global, Scoop, WinGet, the opencode CLI bin) — so `opencode` resolves outside the app but
 * not inside it until these are prepended when present.
 */
function userBinCandidates(): string[] {
    if (process.platform === 'win32') {
        const home = process.env.USERPROFILE || ''
        const appData = process.env.APPDATA || (home ? path.join(home, 'AppData', 'Roaming') : '')
        const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '')
        return [
            appData ? path.join(appData, 'npm') : '',
            localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links') : '',
            home ? path.join(home, 'scoop', 'shims') : '',
            home ? path.join(home, '.opencode', 'bin') : '',
            home ? path.join(home, '.local', 'bin') : '',
            localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps') : '',
        ].filter(Boolean)
    }
    const home = process.env.HOME || ''
    return [
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        home ? path.join(home, '.local', 'bin') : '',
        home ? path.join(home, '.opencode', 'bin') : '',
    ].filter(Boolean)
}

function shellCommand(preferred: TerminalShell): { file: string; args: string[]; label: string } {
    if (process.platform !== 'win32') {
        const file = process.env.SHELL || '/bin/bash'
        return { file, args: [], label: path.basename(file) }
    }
    const cmd = process.env.COMSPEC || 'cmd.exe'
    const cmdArgs = ['/d', '/s', '/k', 'chcp 65001 >nul']
    // PowerShell 7 is the default, but it is installed separately: without it the request silently
    // resolves to Command Prompt so a fresh install still opens a working shell.
    if (preferred === 'pwsh') return hasPwsh() ? { file: 'pwsh.exe', args: POWER_SHELL_ARGS, label: 'pwsh' } : { file: cmd, args: cmdArgs, label: 'cmd' }
    if (preferred === 'powershell') return { file: 'powershell.exe', args: POWER_SHELL_ARGS, label: 'powershell' }
    return { file: cmd, args: cmdArgs, label: 'cmd' }
}

/** xterm can briefly report 0 while a panel is hidden — never create/resize a pty with invalid dimensions. */
function clampCols(cols: number): number {
    return Math.max(2, Math.floor(cols) || 80)
}

function clampRows(rows: number): number {
    return Math.max(1, Math.floor(rows) || 24)
}

/**
 * Starts (or returns) the shell for a terminal id. `rows`/`cols` come from the renderer's xterm so
 * the first paint is already correctly sized. Reusing an existing session is the whole point of the
 * stable-id model: a panel that remounts (the repo tabs rebuild mid-switch) re-sends the same id and
 * gets its live shell + scrollback back instead of spawning a second one.
 */
export function createTerminal(
    terminalId: string,
    repoPath: string,
    cols: number,
    rows: number,
    preferred: TerminalShell = 'pwsh'
): void {
    if (!terminalId) throw new Error('Terminal id is required')
    if (!repoPath || !fs.existsSync(repoPath)) throw new Error(`Repository path does not exist: ${repoPath}`)
    const existing = sessions.get(terminalId)
    if (existing) {
        resizeTerminal(terminalId, cols, rows)
        return
    }

    const shell = shellCommand(preferred)
    let ptyProcess: IPty
    try {
        ptyProcess = loadPty().spawn(shell.file, shell.args, {
            name: 'xterm-256color',
            cwd: repoPath,
            cols: clampCols(cols),
            rows: clampRows(rows),
            env: terminalEnv(),
            // node-pty's bundled conpty.dll, NOT the OS ConPTY: the OS one corrupts Thai inside TUI
            // redraws (opencode dropped half a typed word and kept a stale placeholder fragment),
            // while this one renders it exactly. Its cost is a ~3 s delay before the first screen —
            // after that output streams normally — which TerminalView covers with a starting hint.
            useConptyDll: process.platform === 'win32',
        } as never)
    } catch (error) {
        // The package can load while its prebuilt binary is missing/mismatched, and a chosen shell
        // (e.g. pwsh.exe on a machine that only has Windows PowerShell) may not exist at all — say so
        // plainly instead of surfacing node-pty's raw loader error in the panel.
        const missing = /error code: 2\b/.test(String(error))
        throw new Error(
            missing
                ? `Terminal is unavailable — ${shell.file} was not found. Install it or pick another shell in Settings → Terminal.`
                : `Terminal is unavailable — node-pty could not start ${shell.file} (${String(error)})`
        )
    }

    // Store the same clamped values the pty was created with, so the first resize comparison is honest.
    const session: TerminalSession = { id: terminalId, repoPath, pty: ptyProcess, cols: clampCols(cols), rows: clampRows(rows) }
    sessions.set(terminalId, session)

    ptyProcess.onData(data => onData?.({ terminalId, repoPath, data }))
    ptyProcess.onExit(({ exitCode, signal }) => {
        // Only clear if this is still the live session for the id (a fast reopen
        // may have replaced it before the old shell's exit event lands).
        if (sessions.get(terminalId) === session) sessions.delete(terminalId)
        onExit?.({ terminalId, repoPath, exitCode, signal })
    })

    log('info', 'terminal', `spawn ${terminalId} in ${path.basename(repoPath)} (${shell.file})`)
}

function terminalEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') env[key] = value
    }
    // Electron's packaged env inherits the app bundle; make sure TERM/COLORTERM advertise 256 colors.
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    if (!env.LANG) env.LANG = 'en_US.UTF-8'
    // A GUI launch inherits a login-time PATH snapshot, so CLIs installed into user bins
    // (npm global, Scoop, WinGet, ~/.opencode/bin) resolve in an interactive shell but not here.
    // Prepend the ones that exist and are missing — never replacing what is already there.
    const key = pathKeyFor(Object.keys(env), process.platform === 'win32' ? 'Path' : 'PATH')
    const before = env[key] || ''
    const merged = mergePathValue(
        before,
        userBinCandidates().filter(dir => dirExists(dir)),
        path.delimiter,
        process.platform === 'win32'
    )
    if (merged !== before) {
        env[key] = merged
        log('debug', 'terminal', 'augmented PATH with user bins')
    }
    return env
}

export function writeTerminal(terminalId: string, data: string): void {
    sessions.get(terminalId)?.pty.write(data)
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const session = sessions.get(terminalId)
    if (!session) return
    const safeCols = clampCols(cols)
    const safeRows = clampRows(rows)
    if (session.cols === safeCols && session.rows === safeRows) return
    try {
        session.pty.resize(safeCols, safeRows)
        session.cols = safeCols
        session.rows = safeRows
    } catch {}
}

/** Kills and drops one shell (its tab ✕, or the panel closing every terminal of a repo). */
export function disposeTerminal(terminalId: string): void {
    const session = sessions.get(terminalId)
    if (!session) return
    sessions.delete(terminalId)
    try {
        session.pty.kill()
    } catch {}
    log('info', 'terminal', `dispose ${terminalId} (${path.basename(session.repoPath)})`)
}

/**
 * Kills every shell of a repo. Only the renderer's "close repo tab" action calls this — a workspace
 * switch also closes git instances, and those shells must survive it.
 */
export function disposeTerminalsForRepo(repoPath: string): number {
    let killed = 0
    for (const session of sessions.values()) {
        if (session.repoPath !== repoPath) continue
        sessions.delete(session.id)
        killed++
        try {
            session.pty.kill()
        } catch {}
    }
    if (killed) log('info', 'terminal', `dispose ${killed} terminal(s) in ${path.basename(repoPath)}`)
    return killed
}

/** Kills every shell everywhere — the panel's "kill all" action and app quit. */
export function disposeAllTerminals(): number {
    const count = sessions.size
    for (const session of sessions.values()) {
        try {
            session.pty.kill()
        } catch {}
    }
    sessions.clear()
    if (count) log('info', 'terminal', `dispose all ${count} terminal(s)`)
    return count
}

/** True when node-pty can actually be loaded in this process (drives the renderer's availability gate). */
export function terminalAvailable(): boolean {
    try {
        loadPty()
        return true
    } catch {
        return false
    }
}

/** Short shell label for a tab ("cmd 1") without spawning anything. */
export function terminalShellName(preferred: TerminalShell = 'pwsh'): string {
    return shellCommand(preferred).label
}
