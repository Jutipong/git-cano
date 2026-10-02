import * as fs from 'node:fs'
import * as path from 'node:path'

import { log } from './logger'

import type { TerminalData, TerminalExit } from '@shared/types'
import type { IPty } from 'node-pty'

type PtyModule = { spawn: (file: string, args: string[] | string, options: unknown) => IPty }

/** One interactive shell per repo path — the panel is single-tab, so a plain 1:1 map is enough. */
interface TerminalSession {
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

/** xterm can briefly report 0 while a panel is hidden — never create/resize a pty with invalid dimensions. */
function clampCols(cols: number): number {
    return Math.max(2, Math.floor(cols) || 80)
}

function clampRows(rows: number): number {
    return Math.max(1, Math.floor(rows) || 24)
}

/**
 * Starts (or returns) the shell for a repo. `rows`/`cols` come from the renderer's xterm so the
 * first paint is already correctly sized. Reusing an existing session is the whole point of the
 * per-repo model: switching tabs and back keeps the same shell + scrollback alive.
 */
export function createTerminal(repoPath: string, cols: number, rows: number): void {
    if (!repoPath || !fs.existsSync(repoPath)) throw new Error(`Repository path does not exist: ${repoPath}`)
    const existing = sessions.get(repoPath)
    if (existing) {
        resizeTerminal(repoPath, cols, rows)
        return
    }

    const ptyProcess = loadPty().spawn(defaultShell(), [], {
        name: 'xterm-256color',
        cwd: repoPath,
        cols: clampCols(cols),
        rows: clampRows(rows),
        env: terminalEnv(),
    } as never)

    // Store the same clamped values the pty was created with, so the first resize comparison is honest.
    const session: TerminalSession = { pty: ptyProcess, cols: clampCols(cols), rows: clampRows(rows) }
    sessions.set(repoPath, session)

    ptyProcess.onData(data => onData?.({ repoPath, data }))
    ptyProcess.onExit(({ exitCode, signal }) => {
        // Only clear if this is still the live session for the path (a fast reopen
        // may have replaced it before the old shell's exit event lands).
        if (sessions.get(repoPath) === session) sessions.delete(repoPath)
        onExit?.({ repoPath, exitCode, signal })
    })

    log('info', 'terminal', `spawn ${path.basename(repoPath)} (${defaultShell()})`)
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

export function writeTerminal(repoPath: string, data: string): void {
    sessions.get(repoPath)?.pty.write(data)
}

export function resizeTerminal(repoPath: string, cols: number, rows: number): void {
    const session = sessions.get(repoPath)
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

/** Kills and drops the shell for a repo. Called when the user closes the panel or the tab. */
export function disposeTerminal(repoPath: string): void {
    const session = sessions.get(repoPath)
    if (!session) return
    sessions.delete(repoPath)
    try {
        session.pty.kill()
    } catch {}
    log('info', 'terminal', `dispose ${path.basename(repoPath)}`)
}

/** Kills every shell — app quit. Scrollback/pty are never persisted, so this is a clean slate. */
export function disposeAllTerminals(): void {
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

/** Default shell label for display (e.g. the panel header). */
export function terminalShellName(): string {
    return defaultShell().split(/[\\/]/).pop() || defaultShell()
}
