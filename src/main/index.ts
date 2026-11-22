import * as path from 'node:path'

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'

import { onRepoChanged } from './git'
import { registerIpcHandlers } from './ipc'
import { log } from './logger'
import { disposeAllTerminals, onTerminalData, onTerminalExit } from './terminal'
import { initAutoUpdater } from './updater'

let win: BrowserWindow | null = null

const REPO_URL = 'https://github.com/Jutipong/git-cano'

/** Push a fire-and-forget message to the renderer window (menu items use this). */
function sendToRenderer(channel: string, payload?: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

onRepoChanged(repoPath => {
    if (win && !win.isDestroyed()) win.webContents.send('repo:changed', repoPath)
})

onTerminalData(payload => sendToRenderer('terminal:data', payload))
onTerminalExit(payload => sendToRenderer('terminal:exit', payload))

function createWindow(): void {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        title: 'Git Cano',
        backgroundColor: '#1e2227',
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (process.env.ELECTRON_RENDERER_URL) {
        void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
}

/**
 * Replace the default application menu so its Zoom In/Out/Reset accelerators (Ctrl+= / Ctrl+- / Ctrl+0) can't fight the app's own ui.zoom
 * setting — zoom is owned by the renderer's ui store (which drives Electron page zoom through webFrame) instead. Ctrl/Cmd+W is also freed
 * from the native Close-window role so it closes the active repo tab instead (window close stays available via Ctrl/Cmd+Shift+W).
 *
 * The Window menu is hand-written on both platforms (the stock `windowMenu` role can't be extended) and carries only the app's own items:
 * What's new, and About Git Cano → the repository.
 */
function setupMenu(): void {
    const isMac = process.platform === 'darwin'
    // macOS app menu, hand-written so the stock About dialog can be hidden —
    // the app links to its repository from Window → About Git Cano instead.
    // No separator right after the hidden About, or a stray line shows at the top.
    const appMenu: MenuItemConstructorOptions = {
        label: app.name,
        submenu: [
            { role: 'about', visible: false },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
        ],
    }
    // Keep the Close role alive but invisible on Windows/Linux — removing the item
    // outright would take the Ctrl/Cmd+Shift+W close-window accelerator with it.
    const hiddenClose: MenuItemConstructorOptions = { role: 'close', accelerator: 'CommandOrControl+Shift+W', visible: false }
    const template: MenuItemConstructorOptions[] = [
        ...(isMac ? [appMenu] : []),
        // File → Close owns Cmd+W on macOS — rebind it so Cmd+W reaches the renderer.
        isMac ? { label: 'File', submenu: [{ role: 'close', accelerator: 'Command+Shift+W' }] } : { role: 'fileMenu' },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        // Hand-written Window menu (both platforms) so it can carry the app's own items.
        {
            label: 'Window',
            submenu: [
                { label: "What's new", click: () => sendToRenderer('changelog:open') },
                { label: 'About Git Cano', click: () => void shell.openExternal(REPO_URL) },
                ...(isMac ? [] : [hiddenClose]),
            ],
        },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
    log('info', 'app', `ready (version ${app.getVersion()}, log level ${process.env.GIT_CANO_LOG_LEVEL ?? 'auto'})`)
    setupMenu()
    initAutoUpdater(() => win)
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

// Shells are never persisted — kill every pty on quit so no orphan process survives.
app.on('before-quit', () => disposeAllTerminals())
app.on('quit', () => disposeAllTerminals())
