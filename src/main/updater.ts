import { app, shell, type BrowserWindow } from 'electron'
import pkg, { type AppUpdater } from 'electron-updater'

import { log, summarize } from './logger'

const { autoUpdater } = pkg as unknown as { autoUpdater: AppUpdater }

/** Retry pauses for transient failures; 3 extra attempts, ~7s total worst case. */
const RETRY_DELAYS_MS = [1000, 2000, 4000]

let getWin: () => BrowserWindow | null = () => null
let started = false

function rawMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/** 5xx from the release CDN and momentary network failures are worth repeating; everything else is final. */
function isTransient(err: unknown): boolean {
    const message = rawMessage(err)
    return /\b5\d{2}\b/.test(message) || /net::|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|Gateway Time-out/i.test(message)
}

/** Short user-facing text — the raw electron-updater error dumps a whole HTML body into the dialog. */
function friendlyMessage(err: unknown): string {
    const message = rawMessage(err)
    const status = /\b(5\d{2})\b/.exec(message)?.[1]
    if (status) return `GitHub is temporarily unavailable (HTTP ${status}). Try again in a moment.`
    if (/net::|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(message)) {
        return 'Could not reach GitHub. Check your connection and try again.'
    }
    return message.replace(/^Error:\s*/, '')
}

async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            // Sequential by design: each retry depends on the previous failure.
            // oxlint-disable-next-line no-await-in-loop
            return await run()
        } catch (err) {
            const delay = RETRY_DELAYS_MS[attempt]
            if (delay === undefined || !isTransient(err)) {
                log('warn', 'updater', `${label} failed: ${friendlyMessage(err)}`)
                throw new Error(friendlyMessage(err))
            }
            log('warn', 'updater', `${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${friendlyMessage(err)}`)
            // oxlint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }
}

/** True only for the installed Windows build (NSIS Setup .exe). macOS stays manual (unsigned dmg). Dev is never auto. */
export function isAutoUpdateSupported(): boolean {
    if (process.platform !== 'win32') return false
    if (!app.isPackaged) return false
    return true
}

function send(channel: string, payload?: unknown): void {
    try {
        const w = getWin()
        if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
    } catch {}
}

/** Wire electron-updater events to the renderer. Safe to call when unsupported (no-op). */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
    getWin = getWindow
    if (started) return
    started = true
    if (!isAutoUpdateSupported()) {
        log('info', 'updater', 'auto-update disabled (manual download only)')
        return
    }
    autoUpdater.logger = {
        info: (message?: unknown) => log('info', 'updater', summarize(message)),
        warn: (message?: unknown) => log('warn', 'updater', summarize(message)),
        error: (message?: unknown) => log('error', 'updater', summarize(message)),
        debug: (message?: unknown) => log('debug', 'updater', summarize(message)),
    }
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', progress => {
        send('update:progress', {
            percent: Math.round(progress.percent),
            bytesPerSecond: Math.round(progress.bytesPerSecond),
            transferred: progress.transferred,
            total: progress.total,
        })
    })
    autoUpdater.on('update-downloaded', info => {
        log('info', 'updater', `downloaded ${info.version}`)
        send('update:downloaded', { version: info.version })
    })
    autoUpdater.on('error', err => {
        const message = friendlyMessage(err)
        log('warn', 'updater', `error ${message}`)
        send('update:error', message)
    })
    log('info', 'updater', 'auto-update ready (win32 nsis)')
}

/** Re-validates via the feed, then downloads. Resolves with the downloaded version. */
export async function downloadUpdate(): Promise<string> {
    if (!isAutoUpdateSupported()) throw new Error('Automatic download is only available in the installed Windows app')
    const result = await withRetry('checkForUpdates', () => autoUpdater.checkForUpdates())
    const info = result?.updateInfo
    if (!info || !info.version) throw new Error('No update found')
    log('info', 'updater', `downloading ${info.version}`)
    await withRetry('downloadUpdate', () => autoUpdater.downloadUpdate())
    return info.version
}

/** Restarts the app to install the downloaded update. */
export function installUpdate(): void {
    if (!isAutoUpdateSupported()) throw new Error('Automatic install is only available in the installed Windows app')
    autoUpdater.quitAndInstall(false, true)
}

/** Manual fallback for macOS / dev — opens the release page in a browser. */
export async function openReleasePage(url: string): Promise<void> {
    const target = String(url || '').trim()
    if (!/^https:\/\//i.test(target)) throw new Error('Invalid release URL')
    await shell.openExternal(target)
}
