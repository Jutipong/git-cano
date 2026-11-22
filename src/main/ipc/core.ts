import { ipcMain } from 'electron'

import { log, summarizeArgs } from '../logger'
import { isOpen } from '../git'

/** Shared IPC plumbing: every feature slice registers through these helpers. */

type Handler = (...args: never[]) => Promise<unknown> | unknown

function ipcErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message.replace(/^Error:\s*(spawn|fatal:)?\s*/i, '') : String(err)
}

export function handle(channel: string, fn: Handler): void {
    ipcMain.handle(channel, async (_e, ...args) => {
        const started = Date.now()
        try {
            const result = await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
            log('debug', 'ipc', `${channel} ok ${Date.now() - started}ms ${summarizeArgs(args)}`)
            return result
        } catch (err) {
            const message = ipcErrorMessage(err)
            log('warn', 'ipc', `${channel} ERR ${message} ${summarizeArgs(args)}`)
            return { __error: message }
        }
    })
}

export function handleSensitive(channel: string, fn: Handler): void {
    ipcMain.handle(channel, async (_e, ...args) => {
        try {
            return await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
        } catch (err) {
            const message = ipcErrorMessage(err)
            log('warn', 'ipc', `${channel} ERR ${message}`)
            return { __error: message }
        }
    })
}

export function requireRepo(): boolean {
    if (!isOpen()) throw new Error('No repository opened')
    return true
}

/** Repo-scoped channel: fails with "No repository opened" before the handler runs. */
export function handleRepo(channel: string, fn: Handler): void {
    handle(channel, (...args: never[]) => {
        requireRepo()
        return fn(...args)
    })
}

/** Repo-scoped sensitive channel (arguments are never logged). */
export function handleSensitiveRepo(channel: string, fn: Handler): void {
    handleSensitive(channel, (...args: never[]) => {
        requireRepo()
        return fn(...args)
    })
}
