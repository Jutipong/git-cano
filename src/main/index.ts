import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'

import {
    authGitEnv,
    generateSshKey,
    getAuthConfig,
    githubStatus,
    listSshKeys,
    openGithubTokenPage,
    openSshDir,
    saveAuthConfig,
    testSshKey,
    verifyGithubToken,
    deleteSshKey,
    refreshGithubProfile,
} from './auth'
import {
    checkoutWithOptions,
    checkoutRemoteWithOptions,
    checkCherryPickConflicts,
    closeRepo,
    createBranchWithOptions,
    deleteBranch,
    deleteRemoteBranch,
    discard,
    discardUnstaged,
    fetchAll,
    getCommitBody,
    getCommitDetails,
    getDiff,
    getLog,
    getLogPage,
    getSoloLog,
    getSoloLogPage,
    getCachedLog,
    getCachedBranches,
    getStatusAccelerators,
    setStatusAccelerators,
    getStatus,
    getActiveRepoPath,
    hasRemote,
    isOpen,
    listStashes,
    createStash,
    applyStash,
    dropStash,
    getStashFiles,
    getStashFileDiff,
    getStashFileMeta,
    getStashImageVersion,
    revertCommit,
    checkoutCommit,
    getRepoState,
    setActiveRepo,
    getDiffMeta,
    getImageVersion,
    checkoutSide,
    markResolved,
    readConflictFile,
    conflictVersions,
    saveResolvedFile,
    continueMerge,
    abortMerge,
    rebaseAbort,
    rebaseContinue,
    cherryPick,
    cherryPickContinue,
    cherryPickAbort,
    resetTo,
    getCommitFileDiff,
    getCommitFileMeta,
    getCommitImageVersion,
    getWorkdirFileContent,
    getCommitFileContent,
    getStashFileContent,
    getRebasePlan,
    startInteractiveRebase,
    getSquashPlan,
    squashCommits,
    listReflog,
    restoreReflog,
    listBranches,
    listSoloFiles,
    mergeInto,
    checkMergeConflicts,
    onRepoChanged,
    openRepo,
    pull,
    push,
    pushBranch,
    pullBranch,
    stage,
    stageAll,
    unstage,
    unstageAll,
    commitMessage,
    undoById,
    peekUndo,
    listTags,
    createTag,
    deleteTag,
    pushTag,
    listRemoteTags,
    deleteRemoteTag,
    listRemotes,
    addRemote,
    setRemoteUrl,
    testRemoteUrl,
    getRawPatch,
    stageHunks,
    sshTestHost,
    getFileHistory,
    getBlame,
    getMarkdownImage,
    listFiles,
    addIgnoreRule,
    plainGit,
    baseEnv,
} from './git'
import { log, summarize, summarizeArgs } from './logger'
import { cancelModelCall, generateCommitMessage, getConfig, listModels, saveConfig, testConnection } from './opencode'
import {
    createTerminal,
    disposeAllTerminals,
    disposeTerminal,
    disposeTerminalsForRepo,
    onTerminalData,
    onTerminalExit,
    resizeTerminal,
    terminalAvailable,
    terminalShellName,
    writeTerminal,
} from './terminal'
import { downloadUpdate, initAutoUpdater, installUpdate, isAutoUpdateSupported, openReleasePage } from './updater'

import type { LocalChangesMode, MergeMode, TerminalShell } from '@shared/types'

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

function handle(channel: string, fn: (...args: never[]) => Promise<unknown> | unknown): void {
    ipcMain.handle(channel, async (_e, ...args) => {
        const started = Date.now()
        try {
            const result = await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
            log('debug', 'ipc', `${channel} ok ${Date.now() - started}ms ${summarizeArgs(args)}`)
            return result
        } catch (err) {
            const message = err instanceof Error ? err.message.replace(/^Error:\s*(spawn|fatal:)?\s*/i, '') : String(err)
            log('warn', 'ipc', `${channel} ERR ${message} ${summarizeArgs(args)}`)
            return { __error: message }
        }
    })
}

function handleSensitive(channel: string, fn: (...args: never[]) => Promise<unknown> | unknown): void {
    ipcMain.handle(channel, async (_e, ...args) => {
        try {
            return await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
        } catch (err) {
            const message = err instanceof Error ? err.message.replace(/^Error:\s*(spawn|fatal:)?\s*/i, '') : String(err)
            log('warn', 'ipc', `${channel} ERR ${message}`)
            return { __error: message }
        }
    })
}

function requireRepo(): boolean {
    if (!isOpen()) throw new Error('No repository opened')
    return true
}

/**
 * Launches an external app (VS Code, Windows Terminal, Kiro, Rider, Visual Studio) and reports
 * spawn/exit failures. `detached` is load-bearing: libuv puts every non-detached child in a
 * kill-on-close Windows job, so the app opened here would be terminated the moment git-cano
 * quits. `unref()` keeps the child out of the main process' event loop as well — it must outlive
 * git-cano, not depend on it.
 */
function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: 'ignore', detached: true })
        child.unref()
        child.on('error', err => reject(new Error(`Failed to launch "${cmd}": ${err.message}`)))
        child.on('exit', code => {
            if (code === 0) resolve()
            else reject(new Error(`"${cmd}" exited with code ${code}`))
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

function openTerminal(dir: string): Promise<void> {
    if (process.platform === 'win32') {
        return runCmd('wt', ['-d', dir], dir).catch(() => runCmd('cmd.exe', [], dir))
    }
    if (process.platform !== 'darwin') {
        return Promise.reject(new Error(`Opening a terminal is not supported on ${process.platform} yet`))
    }
    return runCmd('open', ['-a', 'Terminal', dir], dir)
}

function openFolder(dir: string): Promise<void> {
    return shell.openPath(dir).then(errorMessage => {
        if (errorMessage) throw new Error(errorMessage)
    })
}

function openVSCode(dir: string): Promise<void> {
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

interface OpenInTargets {
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

async function getOpenInTargets(dir: string): Promise<OpenInTargets> {
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

function openRider(dir: string): Promise<void> {
    const exe = findRider()
    if (!exe) return Promise.reject(new Error('Rider not found — install it via JetBrains Toolbox or the standalone installer'))
    return runCmd(exe, [csharpOpenTarget(dir)], dir)
}

async function openVisualStudio(dir: string): Promise<void> {
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

function openKiro(dir: string): Promise<void> {
    const exe = findKiro()
    if (exe) return runCmd(exe, [dir], dir)
    if (process.platform === 'darwin') {
        return runCmd('open', ['-a', 'Kiro', dir], dir)
    }
    return Promise.reject(new Error('Kiro not found — install it from kiro.dev'))
}

const LOG_LEVELS = new Set(['info', 'warn', 'error'])
ipcMain.on('app:log', (_e, level: string, message: unknown) => {
    const safeLevel = LOG_LEVELS.has(level) ? (level as 'info' | 'warn' | 'error') : 'info'
    log(safeLevel, 'renderer', summarize(message))
})

/** Main-process app settings (currently: the opt-in Windows status accelerators + the default folder-picker directory). */
interface AppSettings {
    statusAccelerators?: boolean
    defaultOpenDir?: string
}

function appSettingsFile(): string {
    return path.join(app.getPath('userData'), 'settings.json')
}

function readAppSettings(): AppSettings {
    try {
        return JSON.parse(fs.readFileSync(appSettingsFile(), 'utf8')) as AppSettings
    } catch {
        return {}
    }
}

function writeAppSettings(patch: AppSettings): void {
    try {
        fs.writeFileSync(appSettingsFile(), JSON.stringify({ ...readAppSettings(), ...patch }))
    } catch {}
}

/**
 * Starting directory for every folder-picker dialog: the user's configured default folder when it exists on disk, otherwise the parent of
 * the most recently opened repository, otherwise left to the OS.
 */
function startDir(): string | undefined {
    const configured = readAppSettings().defaultOpenDir?.trim()
    if (configured) {
        try {
            if (fs.statSync(configured).isDirectory()) return configured
        } catch {}
    }
    try {
        const file = path.join(app.getPath('userData'), 'recent.json')
        const list = JSON.parse(fs.readFileSync(file, 'utf8')) as string[]
        const last = list[0]
        if (last) return path.dirname(last)
    } catch {}
    return undefined
}

/**
 * Replace the default application menu so its Zoom In/Out/Reset accelerators (Ctrl+= / Ctrl+- / Ctrl+0) can't zoom the web frame behind the
 * app's own ui.zoom setting — zoom is owned by the renderer's ui store instead.
 * Ctrl/Cmd+W is also freed from the native Close-window role so it closes the active repo tab instead
 * (window close stays available via Ctrl/Cmd+Shift+W).
 *
 * The Window menu is hand-written on both platforms (the stock `windowMenu` role can't be extended)
 * and carries only the app's own items: What's new, and About Git Cano → the repository.
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
        isMac
            ? { label: 'File', submenu: [{ role: 'close', accelerator: 'Command+Shift+W' }] }
            : { role: 'fileMenu' },
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
    handle('update:canAuto', () => isAutoUpdateSupported())
    handle('update:download', () => downloadUpdate())
    handle('update:install', () => {
        installUpdate()
        return true
    })
    handle('update:openRelease', (_url: string) => openReleasePage(String(_url ?? '')))
    setStatusAccelerators(readAppSettings().statusAccelerators === true)
    handle('app:getStatusAccelerators', () => getStatusAccelerators())
    handle('app:setStatusAccelerators', (_v: boolean) => {
        setStatusAccelerators(_v === true)
        // Persist the effective value — the git.ts gate forces false outside Windows.
        const enabled = getStatusAccelerators()
        writeAppSettings({ statusAccelerators: enabled })
        return enabled
    })
    handle('app:getDefaultOpenDir', () => readAppSettings().defaultOpenDir ?? '')
    handle('app:setDefaultOpenDir', (_dir: string) => {
        const dir = String(_dir).trim()
        if (dir) {
            let stat: fs.Stats
            try {
                stat = fs.statSync(dir)
            } catch {
                throw new Error(`Folder does not exist: ${dir}`)
            }
            if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`)
        }
        writeAppSettings({ defaultOpenDir: dir || undefined })
        return true
    })
    handle('repo:pickAndOpen', async () => {
        const res = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: startDir() })
        if (res.canceled || !res.filePaths[0]) return null
        return openRepo(res.filePaths[0])
    })
    handle('repo:pickDir', async () => {
        const res = await dialog.showOpenDialog({
            title: 'Choose destination folder for clone',
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: startDir(),
        })
        if (res.canceled || !res.filePaths[0]) return null
        return res.filePaths[0]
    })
    handle('repo:clone', async (_url: string, _dest?: string) => {
        const url = _url as string
        let dest = _dest as string | undefined
        if (!dest) {
            const res = await dialog.showOpenDialog({
                title: 'Choose destination folder',
                properties: ['openDirectory', 'createDirectory'],
                defaultPath: startDir(),
            })
            if (res.canceled || !res.filePaths[0]) return null
            dest = res.filePaths[0]
        }
        const destPath = path.join(dest, path.basename(url, '.git'))
        const g = plainGit()
        g.env({ ...baseEnv(), ...authGitEnv() })
        await g.clone(url, destPath)
        return openRepo(destPath)
    })
    handle('repo:openPath', (_dir: string) => openRepo(_dir as string))
    handle('repo:setActive', (_dir: string) => setActiveRepo(_dir as string))
    handle('repo:status', () => {
        requireRepo()
        return getStatus()
    })
    handle('repo:close', (_dir?: string) => {
        // Resolve the target exactly like closeRepo() does, so a no-arg close releases the right instance.
        const target = typeof _dir === 'string' && _dir ? _dir : getActiveRepoPath()
        closeRepo(target ?? undefined)
        return isOpen()
    })
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
    handle('app:openTerminal', (dir: string) => openTerminal(dir as string))
    handle('app:openExternal', (url: string) => {
        const target = String(url ?? '').trim()
        if (!/^https?:\/\//i.test(target)) throw new Error('Only http(s) links can be opened externally')
        return shell.openExternal(target)
    })
    handle('app:openInFolder', (dir: string) => openFolder(dir as string))
    handle('app:openInVSCode', (dir: string) => openVSCode(dir as string))
    handle('app:getOpenInTargets', (dir: string) => getOpenInTargets(dir as string))
    handle('app:openInKiro', (dir: string) => openKiro(dir as string))
    handle('app:openInRider', (dir: string) => openRider(dir as string))
    handle('app:openInVisualStudio', (dir: string) => openVisualStudio(dir as string))
    handle('app:getVersion', () => app.getVersion())
    handle('repo:log', (_limit?: number) => {
        requireRepo()
        return getLog(typeof _limit === 'number' ? _limit : 500)
    })
    handle('repo:logCached', (_limit?: number) => {
        requireRepo()
        return getCachedLog(typeof _limit === 'number' ? _limit : 500)
    })
    handle('repo:logPage', (_offset?: number, _limit?: number) => {
        requireRepo()
        return getLogPage(typeof _offset === 'number' ? _offset : 0, typeof _limit === 'number' ? _limit : 500)
    })
    handle('repo:logSolo', (branch?: string, _limit?: number) => {
        requireRepo()
        return getSoloLog(branch as string, typeof _limit === 'number' ? _limit : 500)
    })
    handle('repo:logSoloPage', (branch?: string, _offset?: number, _limit?: number) => {
        requireRepo()
        return getSoloLogPage(branch as string, typeof _offset === 'number' ? _offset : 0, typeof _limit === 'number' ? _limit : 500)
    })
    handle('file:diff', (file: string, staged: boolean, context?: number) => {
        requireRepo()
        return getDiff(file as string, staged as boolean, typeof context === 'number' ? context : undefined)
    })
    handle('file:diffMeta', (file: string, staged: boolean) => {
        requireRepo()
        return getDiffMeta(file as string, staged as boolean)
    })
    handle('file:image', (file: string, source: 'workdir' | 'index' | 'head') => {
        requireRepo()
        return getImageVersion(file as string, source as 'workdir' | 'index' | 'head')
    })
    handle('commit:details', (hash: string) => {
        requireRepo()
        return getCommitDetails(hash as string)
    })
    handle('commit:body', (hash: string, _dir?: string) => {
        requireRepo()
        return getCommitBody(hash as string, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('commit:revert', (hash: string) => {
        requireRepo()
        return revertCommit(hash as string)
    })
    handle('commit:checkout', (hash: string) => {
        requireRepo()
        return checkoutCommit(hash as string)
    })
    handle('repo:state', () => {
        requireRepo()
        return getRepoState()
    })
    handle('conflict:side', (file: string, side: 'ours' | 'theirs') => {
        requireRepo()
        return checkoutSide(file as string, side as 'ours' | 'theirs')
    })
    handle('conflict:resolved', (files: string[]) => {
        requireRepo()
        return markResolved(files as string[])
    })
    handle('conflict:read', (file: string) => {
        requireRepo()
        return readConflictFile(file as string)
    })
    handle('conflict:versions', (file: string) => {
        requireRepo()
        return conflictVersions(file as string)
    })
    handle('conflict:save', (file: string, content: string) => {
        requireRepo()
        return saveResolvedFile(file as string, content as string)
    })
    handle('merge:continue', () => {
        requireRepo()
        return continueMerge()
    })
    handle('merge:abort', () => {
        requireRepo()
        return abortMerge()
    })
    handle('rebase:abort', () => {
        requireRepo()
        return rebaseAbort()
    })
    handle('rebase:continue', () => {
        requireRepo()
        return rebaseContinue()
    })
    handle('rebase:plan', (ref: string, _dir?: string) => {
        requireRepo()
        return getRebasePlan(ref as string, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('commit:cherryPick', (hash: string) => {
        requireRepo()
        return cherryPick(hash as string)
    })
    handle('commit:cherryPickCheck', (hash: string, target: string) => {
        requireRepo()
        return checkCherryPickConflicts(hash as string, target as string)
    })
    handle('cherryPick:continue', () => {
        requireRepo()
        return cherryPickContinue()
    })
    handle('cherryPick:abort', () => {
        requireRepo()
        return cherryPickAbort()
    })
    handle('ref:reset', (target: string, mode: 'soft' | 'mixed' | 'hard') => {
        requireRepo()
        return resetTo(target as string, mode as 'soft' | 'mixed' | 'hard')
    })
    handle('file:commitDiff', (hash: string, file: string, context?: number) => {
        requireRepo()
        return getCommitFileDiff(hash as string, file as string, typeof context === 'number' ? context : undefined)
    })
    handle('file:commitMeta', (hash: string, file: string) => {
        requireRepo()
        return getCommitFileMeta(hash as string, file as string)
    })
    handle('file:commitImage', (hash: string, file: string) => {
        requireRepo()
        return getCommitImageVersion(hash as string, file as string)
    })
    handle('file:content', (file: string, staged: boolean) => {
        requireRepo()
        return getWorkdirFileContent(file as string, staged as boolean)
    })
    handle('file:commitContent', (hash: string, file: string) => {
        requireRepo()
        return getCommitFileContent(hash as string, file as string)
    })
    handle('stash:fileContent', (hash: string, file: string) => {
        requireRepo()
        return getStashFileContent(hash as string, file as string)
    })
    handle('markdown:image', (mdFile: string, src: string, commitHash?: string | null, stashHash?: string | null) => {
        requireRepo()
        return getMarkdownImage(
            mdFile as string,
            src as string,
            typeof commitHash === 'string' && commitHash ? commitHash : null,
            typeof stashHash === 'string' && stashHash ? stashHash : null
        )
    })
    handle('file:list', (hash?: string) => {
        requireRepo()
        return listFiles(typeof hash === 'string' && hash.trim() ? hash : undefined)
    })
    handle('file:addIgnoreRule', (rule: string) => {
        requireRepo()
        return addIgnoreRule(rule as string)
    })

    handle('file:stage', (paths: string[]) => {
        requireRepo()
        return stage(paths as string[])
    })
    handle('file:stageAll', (_dir?: string) => {
        requireRepo()
        return stageAll(typeof _dir === 'string' && _dir ? _dir : undefined)
    })
    handle('file:unstage', (paths: string[]) => {
        requireRepo()
        return unstage(paths as string[])
    })
    handle('file:unstageAll', () => {
        requireRepo()
        return unstageAll()
    })
    handle('file:discard', (p: string) => {
        requireRepo()
        return discard(p as string)
    })
    handle('file:discardUnstaged', () => {
        requireRepo()
        return discardUnstaged()
    })
    handle('branch:list', () => {
        requireRepo()
        return listBranches()
    })
    handle('branch:cached', () => {
        requireRepo()
        return getCachedBranches()
    })
    handle('branch:soloFiles', (branch?: string, _limit?: number) => {
        requireRepo()
        return listSoloFiles(branch as string, typeof _limit === 'number' ? _limit : 500)
    })
    handle('branch:create', (name: string, co: boolean, startPoint?: string, localChanges?: LocalChangesMode) => {
        requireRepo()
        return createBranchWithOptions(name as string, co as boolean, (localChanges as LocalChangesMode) || 'keep', startPoint)
    })
    handle('branch:checkout', (ref: string, localChanges?: LocalChangesMode) => {
        requireRepo()
        return checkoutWithOptions(ref as string, (localChanges as LocalChangesMode) || 'keep')
    })
    handle('branch:checkoutRemote', (ref: string, localChanges?: LocalChangesMode) => {
        requireRepo()
        return checkoutRemoteWithOptions(ref as string, (localChanges as LocalChangesMode) || 'keep')
    })
    handle('branch:delete', (name: string) => {
        requireRepo()
        return deleteBranch(name as string)
    })
    handle('branch:remoteDelete', (ref: string) => {
        requireRepo()
        return deleteRemoteBranch(ref as string)
    })
    handle('branch:mergeCheck', (source: string, target: string) => {
        requireRepo()
        return checkMergeConflicts(source as string, target as string)
    })
    handle('branch:mergeInto', (source: string, target: string, mode: MergeMode = 'default') => {
        requireRepo()
        return mergeInto(source as string, target as string, mode as MergeMode)
    })
    handle('branch:push', (name: string, force: boolean) => {
        requireRepo()
        return pushBranch(name as string, force as boolean)
    })
    handle('branch:pull', (name: string) => {
        requireRepo()
        return pullBranch(name as string)
    })

    handle('remote:fetch', () => {
        requireRepo()
        return fetchAll()
    })
    handle('remote:push', (force: boolean, _dir?: string) => {
        requireRepo()
        return push(Boolean(force), typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('remote:pull', (rebase: boolean) => {
        requireRepo()
        return pull(Boolean(rebase))
    })
    handle('remote:has', () => {
        requireRepo()
        return hasRemote()
    })

    handle('rebase:start', (baseRef: string, entries, _dir?: string) => {
        requireRepo()
        return startInteractiveRebase(baseRef as string, entries as never[], typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('squash:plan', (target: string) => {
        requireRepo()
        return getSquashPlan(target as string)
    })
    handle('squash:run', (base: string, message: string) => {
        requireRepo()
        return squashCommits(base as string, message as string)
    })
    handle('reflog:list', (limit?: number) => {
        requireRepo()
        return listReflog(typeof limit === 'number' ? limit : 100)
    })
    handle('reflog:restore', (ref: string) => {
        requireRepo()
        return restoreReflog(ref as string)
    })
    handle('commit:message', (message: string, amend: boolean, _dir?: string) => {
        requireRepo()
        return commitMessage(message as string, amend as boolean, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('git:undoPeek', (_dir?: string) => {
        requireRepo()
        return peekUndo(typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('git:undo', (id: number, _dir?: string) => {
        requireRepo()
        return undoById(id as number, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    })
    handle('tag:list', () => {
        requireRepo()
        return listTags()
    })
    handle('tag:create', (name: string, hash: string | null, message?: string) => {
        requireRepo()
        return createTag(name as string, (hash as string) || null, message as string | undefined)
    })
    handle('tag:delete', (name: string) => {
        requireRepo()
        return deleteTag(name as string)
    })
    handle('tag:pushOne', (name: string) => {
        requireRepo()
        return pushTag(name as string)
    })
    handle('tag:remoteList', () => {
        requireRepo()
        return listRemoteTags()
    })
    handle('tag:remoteDelete', (name: string) => {
        requireRepo()
        return deleteRemoteTag(name as string)
    })
    handle('remote:listFull', () => {
        requireRepo()
        return listRemotes()
    })
    handle('remote:addNew', (name: string, url: string) => {
        requireRepo()
        return addRemote(name as string, url as string)
    })
    handle('remote:setUrl', (name: string, url: string) => {
        requireRepo()
        return setRemoteUrl(name as string, url as string)
    })
    handle('remote:testUrl', (url: string) => {
        return testRemoteUrl(url as string)
    })
    handle('patch:raw', (file: string, staged: boolean) => {
        requireRepo()
        return getRawPatch(file as string, staged as boolean)
    })
    handle('patch:stageHunks', (file: string, stagedView: boolean, hunks: number[], reverse: boolean) => {
        requireRepo()
        return stageHunks(file as string, stagedView as boolean, hunks as number[], reverse as boolean)
    })
    handle('file:history', (file: string) => {
        requireRepo()
        return getFileHistory(file as string)
    })
    handle('file:blame', (file: string, rev?: string) => {
        requireRepo()
        return getBlame(file as string, typeof rev === 'string' && rev.trim() ? rev : undefined)
    })
    handle('stash:list', () => {
        requireRepo()
        return listStashes()
    })
    handle('stash:create', (message: string) => {
        requireRepo()
        return createStash(message as string)
    })
    handle('stash:apply', (index: number, pop: boolean) => {
        requireRepo()
        return applyStash(index as number, pop as boolean)
    })
    handle('stash:drop', (index: number) => {
        requireRepo()
        return dropStash(index as number)
    })
    handle('stash:files', (hash: string) => {
        requireRepo()
        return getStashFiles(hash as string)
    })
    handle('stash:fileDiff', (hash: string, file: string, context?: number) => {
        requireRepo()
        return getStashFileDiff(hash as string, file as string, typeof context === 'number' ? context : undefined)
    })
    handle('stash:fileMeta', (hash: string, file: string) => {
        requireRepo()
        return getStashFileMeta(hash as string, file as string)
    })
    handle('stash:imageVersion', (hash: string, file: string) => {
        requireRepo()
        return getStashImageVersion(hash as string, file as string)
    })

    handle('recent:list', () => {
        const file = path.join(app.getPath('userData'), 'recent.json')
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8')) as string[]
        } catch {
            return []
        }
    })
    handle('recent:add', (_p: string) => {
        const file = path.join(app.getPath('userData'), 'recent.json')
        let list: string[] = []
        try {
            list = JSON.parse(fs.readFileSync(file, 'utf8')) as string[]
        } catch {}
        list = [String(_p), ...list.filter(x => x !== _p)].slice(0, 10)
        fs.writeFileSync(file, JSON.stringify(list))
        return true
    })
    handleSensitive('ai:getConfig', () => getConfig())
    handleSensitive('ai:saveConfig', (_cfg: unknown) => saveConfig(_cfg as never))
    handleSensitive('ai:test', (provider: string, token: string, modelId: string) =>
        testConnection(provider as 'opencode-go' | 'openrouter', token as string, modelId as string)
    )
    handleSensitive('ai:generateCommitMessage', (shouldFormat: boolean, scope: string, _dir?: string) => {
        requireRepo()
        return generateCommitMessage(
            Boolean(shouldFormat),
            scope === 'all' ? 'all' : 'staged',
            typeof _dir === 'string' && _dir ? (_dir as string) : undefined
        )
    })
    handleSensitive('ai:listModels', (provider: string, token: string) =>
        listModels(provider as 'opencode-go' | 'openrouter', token as string)
    )
    handleSensitive('ai:cancelGenerate', (_dir?: string) =>
        cancelModelCall(typeof _dir === 'string' && _dir ? (_dir as string) : 'default')
    )

    handleSensitive('auth:getConfig', () => getAuthConfig())
    handleSensitive('auth:saveConfig', (_cfg: unknown) => saveAuthConfig(_cfg as never))
    handleSensitive('auth:ssh:list', () => listSshKeys())
    handleSensitive('auth:ssh:generate', (name: string, comment: string, passphrase?: string) =>
        generateSshKey(String(name), String(comment ?? ''), typeof passphrase === 'string' ? passphrase : undefined)
    )
    handleSensitive('auth:ssh:test', (keyPath: string) => sshTestHost().then(host => testSshKey(String(keyPath), host)))
    handleSensitive('auth:ssh:delete', (keyPath: string) => deleteSshKey(String(keyPath)))
    handle('auth:ssh:openDir', () => openSshDir())
    handleSensitive('auth:github:status', () => githubStatus())
    handleSensitive('auth:github:refresh', () => refreshGithubProfile())
    handleSensitive('auth:github:verify', (token: string) => verifyGithubToken(String(token)))
    handleSensitive('auth:github:openTokenPage', () => openGithubTokenPage())

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
