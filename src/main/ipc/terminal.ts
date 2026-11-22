import {
    createTerminal,
    disposeAllTerminals,
    disposeTerminal,
    disposeTerminalsForRepo,
    resizeTerminal,
    terminalAvailable,
    terminalShellName,
    writeTerminal,
} from '../terminal'
import { handle } from './core'

import type { TerminalShell } from '@shared/types'

/** Terminal slice IPC: one PTY per terminal id. */

export function registerTerminalIpc(): void {
    handle('terminal:create', (id: string, dir: string, cols?: number, rows?: number, shell?: string) => {
        createTerminal(
            String(id),
            String(dir),
            typeof cols === 'number' ? cols : 80,
            typeof rows === 'number' ? rows : 24,
            (shell ?? 'pwsh') as TerminalShell
        )
        return true
    })
    handle('terminal:write', (id: string, data: string) => {
        writeTerminal(String(id), String(data))
        return true
    })
    handle('terminal:resize', (id: string, cols: number, rows: number) => {
        resizeTerminal(String(id), Number(cols), Number(rows))
        return true
    })
    handle('terminal:dispose', (id: string) => {
        disposeTerminal(String(id))
        return true
    })
    // Only the renderer's "close repo tab" action uses this — a workspace switch closes git
    // instances too, and those shells have to survive it.
    handle('terminal:disposeRepo', (dir: string) => disposeTerminalsForRepo(String(dir)))
    handle('terminal:disposeAll', () => disposeAllTerminals())
    handle('terminal:available', () => terminalAvailable())
    handle('terminal:shell', (shell?: string) => terminalShellName((shell ?? 'pwsh') as TerminalShell))
}
