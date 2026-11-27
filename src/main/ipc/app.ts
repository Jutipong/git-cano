import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, ipcMain, shell } from 'electron'

import { getStatusAccelerators, setStatusAccelerators } from '../git'
import { log, summarize } from '../logger'
import { getOpenInTargets, openFileInEditor, openFolder, openKiro, openRider, openTerminal, openVisualStudio, openVSCode } from '../openIn'
import { downloadUpdate, installUpdate, isAutoUpdateSupported, openReleasePage } from '../updater'

import { handle } from './core'

import type { EditorTarget } from '@shared/types'

/** App/system slice: settings, external apps, auto-update, recent repos and renderer logging. */

/** Main-process app settings (currently: the opt-in Windows status accelerators + the last clone root + the last open-repo root). */
interface AppSettings {
    statusAccelerators?: boolean
    lastCloneRoot?: string
    lastOpenRoot?: string
}

function appSettingsFile(): string {
    return path.join(app.getPath('userData'), 'settings.json')
}

export function readAppSettings(): AppSettings {
    try {
        return JSON.parse(fs.readFileSync(appSettingsFile(), 'utf8')) as AppSettings
    } catch {
        return {}
    }
}

export function writeAppSettings(patch: AppSettings): void {
    try {
        fs.writeFileSync(appSettingsFile(), JSON.stringify({ ...readAppSettings(), ...patch }))
    } catch {}
}

function recentFilePath(): string {
    return path.join(app.getPath('userData'), 'recent.json')
}

/**
 * Starting directory for every folder-picker dialog: the last successfully used clone root when it still exists on disk, otherwise the
 * parent of the most recently opened repository, otherwise left to the OS.
 */
export function startDir(): string | undefined {
    const lastRoot = readAppSettings().lastCloneRoot?.trim()
    if (lastRoot) {
        try {
            if (fs.statSync(lastRoot).isDirectory()) return lastRoot
        } catch {}
    }
    try {
        const list = JSON.parse(fs.readFileSync(recentFilePath(), 'utf8')) as string[]
        const last = list[0]
        if (last) return path.dirname(last)
    } catch {}
    return undefined
}

/**
 * Starting directory for the Open repo dialog: the parent of the folder picked there last time, so the user lands next to the repo they
 * just opened. Clone roots must not win here — falls back to startDir() only when no open root is saved or it no longer exists.
 */
export function openStartDir(): string | undefined {
    const lastRoot = readAppSettings().lastOpenRoot?.trim()
    if (lastRoot) {
        try {
            if (fs.statSync(lastRoot).isDirectory()) return lastRoot
        } catch {}
    }
    return startDir()
}

const LOG_LEVELS = new Set(['info', 'warn', 'error'])

export function registerAppIpc(): void {
    setStatusAccelerators(readAppSettings().statusAccelerators === true)

    ipcMain.on('app:log', (_e, level: string, message: unknown) => {
        const safeLevel = LOG_LEVELS.has(level) ? (level as 'info' | 'warn' | 'error') : 'info'
        log(safeLevel, 'renderer', summarize(message))
    })

    handle('update:canAuto', () => isAutoUpdateSupported())
    handle('update:download', () => downloadUpdate())
    handle('update:install', () => {
        installUpdate()
        return true
    })
    handle('update:openRelease', (_url: string) => openReleasePage(String(_url ?? '')))
    handle('app:getStatusAccelerators', () => getStatusAccelerators())
    handle('app:setStatusAccelerators', (_v: boolean) => {
        setStatusAccelerators(_v === true)
        // Persist the effective value — the git/repo.ts gate forces false outside Windows.
        const enabled = getStatusAccelerators()
        writeAppSettings({ statusAccelerators: enabled })
        return enabled
    })
    handle('app:getLastCloneRoot', () => readAppSettings().lastCloneRoot ?? '')
    handle('app:openTerminal', (dir: string) => openTerminal(dir as string))
    handle('app:openExternal', (url: string) => {
        const target = String(url ?? '').trim()
        if (!/^https?:\/\//i.test(target)) throw new Error('Only http(s) links can be opened externally')
        return shell.openExternal(target)
    })
    handle('app:openInFolder', (dir: string) => openFolder(dir as string))
    handle('app:openInVSCode', (dir: string) => openVSCode(dir as string))
    handle('app:openFileInEditor', (target: EditorTarget, repoPath: string, file: string) => openFileInEditor(target, repoPath, file))
    handle('app:getOpenInTargets', (dir: string) => getOpenInTargets(dir as string))
    handle('app:openInKiro', (dir: string) => openKiro(dir as string))
    handle('app:openInRider', (dir: string) => openRider(dir as string))
    handle('app:openInVisualStudio', (dir: string) => openVisualStudio(dir as string))
    handle('app:getVersion', () => app.getVersion())
    handle('recent:list', () => {
        try {
            return JSON.parse(fs.readFileSync(recentFilePath(), 'utf8')) as string[]
        } catch {
            return []
        }
    })
    handle('recent:add', (_p: string) => {
        let list: string[] = []
        try {
            list = JSON.parse(fs.readFileSync(recentFilePath(), 'utf8')) as string[]
        } catch {}
        list = [String(_p), ...list.filter(x => x !== _p)].slice(0, 10)
        fs.writeFileSync(recentFilePath(), JSON.stringify(list))
        return true
    })
}
