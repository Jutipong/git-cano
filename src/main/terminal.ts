import * as fs from 'node:fs'
import * as path from 'node:path'

import { log } from './logger'

import type { TerminalData, TerminalExit, TerminalShellOption } from '@shared/types'
import type { IPty } from 'node-pty'

type PtyModule = { spawn: (file: string, args: string[] | string, options: unknown) => IPty }

/** One interactive shell per terminal tab — a repo can hold several, so sessions are keyed by id. */
interface TerminalSession {
    id: string
    repoPath: string
    pty: IPty
    /** Basename of the spawned executable, for tab labels (`createTerminal` returns it). */
    shell: string
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
 * node-pty is a native module that is only rebuilt for the Electron ABI — it may be missing
 * on a dev machine that never ran the rebuild step. Load it lazily so the rest of the app
 * keeps working and the terminal surfaces a clear error instead of crashing at import time.
 */
function loadPty(): PtyModule {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require('node-pty') as PtyModule
    } catch (error) {
        throw new Error(`Terminal is unavailable — native module node-pty could not be loaded (${String(error)})`)
    }
}

function defaultShell(): string {
    if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
    return process.env.SHELL || '/bin/bash'
}

/**
 * A shell spec comes from Settings → Terminal: `''` (the OS default), a preset id (`cmd` /
 * `powershell` / `pwsh`), or an absolute executable path.
 */
interface ResolvedShell {
    file: string
    args: string[]
}

/**
 * The preset ids Settings offers — Windows-only, kept in sync with `TERMINAL_SHELL_OPTIONS` in
 * renderer stores/ui.ts. macOS/Linux hide the setting and always spawn the OS default.
 */
const SHELL_PRESET_IDS = ['cmd', 'powershell', 'pwsh'] as const

function existingPath(candidate: string | null | undefined): string | null {
    if (!candidate) return null
    try {
        return fs.existsSync(candidate) ? candidate : null
    } catch {
        return null
    }
}

function firstExisting(...candidates: (string | null | undefined)[]): string | null {
    for (const candidate of candidates) {
        const found = existingPath(candidate)
        if (found) return found
    }
    return null
}

/** Scan PATH directories without spawning a process (no `where`/`which` round-trip). */
function findOnPath(name: string): string | null {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue
        const found = existingPath(path.join(dir, name))
        if (found) return found
    }
    return null
}

function envPath(root: string | undefined, ...segments: string[]): string | null {
    return root ? path.join(root, ...segments) : null
}

/**
 * Best-effort resolution of a preset shell, preferring the well-known install locations over PATH so a
 * renamed/wrapped executable cannot shadow the real one. Never spawns anything — Settings calls this
 * for its availability probe and `createTerminal` for the actual spawn.
 */
function shellExecutable(spec: string): string | null {
    // The presets are Windows-only; on macOS/Linux the setting is hidden and ignored.
    if (process.platform !== 'win32') return null
    const root = process.env.SystemRoot || process.env.windir
    switch (spec) {
        case 'cmd':
            return firstExisting(process.env.ComSpec, envPath(root, 'System32', 'cmd.exe')) ?? findOnPath('cmd.exe')
        case 'powershell':
            return (
                firstExisting(envPath(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')) ??
                findOnPath('powershell.exe')
            )
        case 'pwsh':
            return (
                firstExisting(
                    envPath(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
                    envPath(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe')
                ) ?? findOnPath('pwsh.exe')
            )
        default:
            return null
    }
}

/**
 * Turn the configured spec into something node-pty can spawn. `''` keeps the historical OS default
 * (`COMSPEC` on Windows); an unavailable preset throws a readable error that TerminalView shows
 * inline instead of silently falling back to a different shell.
 */
function resolveShell(spec: string): ResolvedShell {
    // Windows-only setting: elsewhere always spawn the OS default, whatever value was persisted.
    if (process.platform !== 'win32') return { file: defaultShell(), args: [] }
    const wanted = spec.trim()
    if (!wanted) return { file: defaultShell(), args: [] }
    const preset = shellExecutable(wanted)
    if (preset) return { file: preset, args: [] }
    // A directly typed path is still accepted (future custom field / hand-edited setting) when it exists.
    if (!(SHELL_PRESET_IDS as readonly string[]).includes(wanted)) {
        const direct = existingPath(wanted)
        if (direct) return { file: direct, args: [] }
    }
    throw new Error(`Shell "${wanted}" not found — pick another shell in Settings → Terminal`)
}

/** Availability of the preset shells on this machine, for Settings → Terminal. Never spawns. */
export function listTerminalShells(): TerminalShellOption[] {
    if (process.platform !== 'win32') return []
    return SHELL_PRESET_IDS.map(id => {
        const file = shellExecutable(id)
        return { id, path: file, available: file !== null }
    })
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
 * gets its live shell + scrollback back instead of spawning a second one. Returns the shell label
 * (basename of the spawned executable) so tab labels reflect the shell that actually runs — a reused
 * session keeps the shell it was spawned with, even when the setting has changed since.
 */
export function createTerminal(terminalId: string, repoPath: string, cols: number, rows: number, shell = ''): string {
    if (!terminalId) throw new Error('Terminal id is required')
    if (!repoPath || !fs.existsSync(repoPath)) throw new Error(`Repository path does not exist: ${repoPath}`)
    const existing = sessions.get(terminalId)
    if (existing) {
        if (existing.repoPath === repoPath) {
            resizeTerminal(terminalId, cols, rows)
            return existing.shell
        }
        // Reuse is only ever safe for the same repo. The renderer's id counter restarts whenever the
        // renderer reloads while ptys (owned here) keep running, so a stale id can point at another
        // repo's shell — reusing it would show the wrong repo's terminal. Kill the stale session and
        // spawn a fresh shell for the repo that is asking. (The renderer also clears orphans on boot.)
        log(
            'warn',
            'terminal',
            `id ${terminalId} belonged to ${path.basename(existing.repoPath)} — respawning for ${path.basename(repoPath)}`
        )
        disposeTerminal(terminalId)
    }

    const resolved = resolveShell(shell)
    const shellName = path.basename(resolved.file)
    const ptyProcess = loadPty().spawn(resolved.file, resolved.args, {
        name: 'xterm-256color',
        cwd: repoPath,
        cols: clampCols(cols),
        rows: clampRows(rows),
        env: terminalEnv(),
    } as never)

    // Store the same clamped values the pty was created with, so the first resize comparison is honest.
    const session: TerminalSession = {
        id: terminalId,
        repoPath,
        pty: ptyProcess,
        shell: shellName,
        cols: clampCols(cols),
        rows: clampRows(rows),
    }
    sessions.set(terminalId, session)

    ptyProcess.onData(data => onData?.({ terminalId, repoPath, data }))
    ptyProcess.onExit(({ exitCode, signal }) => {
        // Only clear if this is still the live session for the id (a fast reopen
        // may have replaced it before the old shell's exit event lands).
        if (sessions.get(terminalId) === session) sessions.delete(terminalId)
        onExit?.({ terminalId, repoPath, exitCode, signal })
    })

    log('info', 'terminal', `spawn ${terminalId} in ${path.basename(repoPath)} (${shellName})`)
    return shellName
}

function terminalEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') env[key] = value
    }
    // Electron's packaged env inherits the app bundle; make sure TERM/COLORTERM advertise 256 colors.
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.LANG = env.LANG || 'en_US.UTF-8'
    // Force a UTF-8 codepage on Windows so the shell emits readable output.
    if (process.platform === 'win32' && !env.CHCP) env.CHCP = '65001'
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
 * Kills every shell of a repo. Called when the repo tab closes — the renderer forgets its terminal
 * state too, so this is the authority that no pty is ever orphaned.
 */
export function disposeTerminalsForRepo(repoPath: string): void {
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
}

/** Kills every shell — app quit. Scrollback/pty are never persisted, so this is a clean slate. */
export function disposeAllTerminals(): void {
    if (sessions.size) log('info', 'terminal', `dispose all ${sessions.size} terminal(s)`)
    for (const session of sessions.values()) {
        try {
            session.pty.kill()
        } catch {}
    }
    sessions.clear()
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

/** Shell label for display (tab labels) — basename of the configured executable, OS default when unset. */
export function terminalShellName(shell = ''): string {
    // Windows-only setting: elsewhere the label is always the OS default.
    const wanted = process.platform === 'win32' ? shell.trim() : ''
    const file = wanted ? (shellExecutable(wanted) ?? existingPath(wanted) ?? wanted) : defaultShell()
    return path.basename(file)
}
