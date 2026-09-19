import { app, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

import { log } from './logger'

let getWin: () => BrowserWindow | null = () => null
let started = false

/**
 * True only for the installed Windows build (NSIS Setup .exe).
 * macOS stays manual (unsigned dmg). Dev is never auto.
 */
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
        const message = err instanceof Error ? err.message : String(err)
        log('warn', 'updater', `error ${message}`)
        send('update:error', message)
    })
    log('info', 'updater', 'auto-update ready (win32 nsis)')
}

/** Re-validates via the feed, then downloads. Resolves with the downloaded version. */
export async function downloadUpdate(): Promise<string> {
    if (!isAutoUpdateSupported()) throw new Error('Automatic download is only available in the installed Windows app')
    const result = await autoUpdater.checkForUpdates()
    const info = result?.updateInfo
    if (!info || !info.version) throw new Error('No update found')
    log('info', 'updater', `downloading ${info.version}`)
    await autoUpdater.downloadUpdate()
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
