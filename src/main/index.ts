import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import {
    checkout,
    closeRepo,
    commit,
    createBranch,
    deleteBranch,
    discard,
    discardAll,
    fetchAll,
    getCommitDetails,
    getDiff,
    getLog,
    getStatus,
    hasRemote,
    isOpen,
    listStashes,
    createStash,
    applyStash,
    dropStash,
    revertCommit,
    checkoutCommit,
    getRepoState,
    setActiveRepo,
    listOpenRepos,
    getDiffMeta,
    getImageVersion,
    checkoutSide,
    markResolved,
    continueMerge,
    abortMerge,
    rebaseOnto,
    rebaseAbort,
    rebaseContinue,
    cherryPick,
    resetTo,
    renameBranch,
    getCommitFileDiff,
    getRebasePlan,
    listBranches,
    merge,
    onRepoChanged,
    openRepo,
    pull,
    push,
    stage,
    stageAll,
    unstage,
    unstageAll,
    commitMessage,
    getLastCommitMessage,
    listTags,
    createTag,
    deleteTag,
    pushTags,
    listRemotes,
    addRemote,
    removeRemote,
    setRemoteUrl,
    getRawPatch,
    stageHunks,
    applyPatch,
    getFileHistory,
    getBlame,
    executeRebasePlan,
    abortPausedRebase,
    bisectStart,
    bisectMark,
    bisectReset,
    listWorktrees,
    addWorktree,
    removeWorktree,
    listSubmodules,
    updateSubmodules,
} from './git'

let win: BrowserWindow | null = null

/* forward external repo changes (commits made outside the app) to the renderer */
onRepoChanged(repoPath => {
    if (win && !win.isDestroyed()) win.webContents.send('repo:changed', repoPath)
})

function createWindow(): void {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        title: 'Open Git',
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

/* wrap handlers so errors surface as {__error} to the renderer */
function handle(channel: string, fn: (...args: never[]) => Promise<unknown> | unknown): void {
    ipcMain.handle(channel, async (_e, ...args) => {
        try {
            return await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
        } catch (err) {
            const message = err instanceof Error ? err.message.replace(/^Error:\s*(spawn|fatal:)?\s*/i, '') : String(err)
            return { __error: message }
        }
    })
}

function requireRepo(): boolean {
    if (!isOpen()) throw new Error('No repository opened')
    return true
}

app.whenReady().then(() => {
    /* ---- repo lifecycle ---- */
    handle('repo:pickAndOpen', async () => {
        const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        if (res.canceled || !res.filePaths[0]) return null
        return openRepo(res.filePaths[0])
    })
    handle('repo:init', async () => {
        const res = await dialog.showOpenDialog({
            title: 'Choose folder for new repository',
            properties: ['openDirectory', 'createDirectory'],
        })
        if (res.canceled || !res.filePaths[0]) return null
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { simpleGit } = await import('simple-git')
        await simpleGit(res.filePaths[0]).init()
        return openRepo(res.filePaths[0])
    })
    handle('repo:clone', async (_url: string) => {
        const url = _url as string
        const res = await dialog.showOpenDialog({
            title: 'Choose destination folder',
            properties: ['openDirectory', 'createDirectory'],
        })
        if (res.canceled || !res.filePaths[0]) return null
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { simpleGit } = await import('simple-git')
        const dest = path.join(res.filePaths[0], path.basename(url, '.git'))
        await simpleGit().clone(url, dest)
        return openRepo(dest)
    })
    handle('repo:openPath', (_dir: string) => openRepo(_dir as string))
    handle('repo:setActive', (_dir: string) => setActiveRepo(_dir as string))
    handle('repo:list', () => listOpenRepos())
    handle('repo:status', () => {
        requireRepo()
        return getStatus()
    })
    handle('repo:close', (_dir?: string) => {
        closeRepo(_dir as string | undefined)
        return isOpen()
    })
    /* ---- log / diff ---- */
    handle('repo:log', (_limit?: number) => {
        requireRepo()
        return getLog(typeof _limit === 'number' ? _limit : 500)
    })
    handle('file:diff', (file: string, staged: boolean) => {
        requireRepo()
        return getDiff(file as string, staged as boolean)
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
    handle('merge:continue', () => {
        requireRepo()
        return continueMerge()
    })
    handle('merge:abort', () => {
        requireRepo()
        return abortMerge()
    })
    handle('rebase:onto', (ref: string) => {
        requireRepo()
        return rebaseOnto(ref as string)
    })
    handle('rebase:abort', () => {
        requireRepo()
        return rebaseAbort()
    })
    handle('rebase:continue', () => {
        requireRepo()
        return rebaseContinue()
    })
    handle('rebase:plan', (ref: string) => {
        requireRepo()
        return getRebasePlan(ref as string)
    })
    handle('commit:cherryPick', (hash: string) => {
        requireRepo()
        return cherryPick(hash as string)
    })
    handle('ref:reset', (target: string, mode: 'soft' | 'mixed' | 'hard') => {
        requireRepo()
        return resetTo(target as string, mode as 'soft' | 'mixed' | 'hard')
    })
    handle('branch:rename', (oldName: string, newName: string) => {
        requireRepo()
        return renameBranch(oldName as string, newName as string)
    })
    handle('file:commitDiff', (hash: string, file: string) => {
        requireRepo()
        return getCommitFileDiff(hash as string, file as string)
    })

    /* ---- staging / commit ---- */
    handle('file:stage', (paths: string[]) => {
        requireRepo()
        return stage(paths as string[])
    })
    handle('file:stageAll', () => {
        requireRepo()
        return stageAll()
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
    handle('file:discardAll', () => {
        requireRepo()
        return discardAll()
    })
    handle('commit:create', (message: string) => {
        requireRepo()
        return commit(message as string)
    })

    /* ---- branches ---- */
    handle('branch:list', () => {
        requireRepo()
        return listBranches()
    })
    handle('branch:create', (name: string, co: boolean) => {
        requireRepo()
        return createBranch(name as string, co as boolean)
    })
    handle('branch:checkout', (ref: string) => {
        requireRepo()
        return checkout(ref as string)
    })
    handle('branch:delete', (name: string) => {
        requireRepo()
        return deleteBranch(name as string)
    })
    handle('branch:merge', (name: string) => {
        requireRepo()
        return merge(name as string)
    })

    /* ---- remotes ---- */
    handle('remote:fetch', () => {
        requireRepo()
        return fetchAll()
    })
    handle('remote:push', () => {
        requireRepo()
        return push()
    })
    handle('remote:pull', () => {
        requireRepo()
        return pull()
    })
    handle('remote:has', () => {
        requireRepo()
        return hasRemote()
    })

    handle('rebase:execute', (baseRef: string, entries, resume: boolean) => {
        requireRepo()
        return executeRebasePlan(baseRef as string, entries as never[], Boolean(resume))
    })
    handle('rebase:abortPaused', () => {
        requireRepo()
        return abortPausedRebase()
    })
    handle('commit:message', (message: string, amend: boolean) => {
        requireRepo()
        return commitMessage(message as string, amend as boolean)
    })
    handle('commit:lastMessage', () => {
        requireRepo()
        return getLastCommitMessage()
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
    handle('tag:push', () => {
        requireRepo()
        return pushTags()
    })
    handle('remote:listFull', () => {
        requireRepo()
        return listRemotes()
    })
    handle('remote:addNew', (name: string, url: string) => {
        requireRepo()
        return addRemote(name as string, url as string)
    })
    handle('remote:removeOne', (name: string) => {
        requireRepo()
        return removeRemote(name as string)
    })
    handle('remote:setUrl', (name: string, url: string) => {
        requireRepo()
        return setRemoteUrl(name as string, url as string)
    })
    handle('patch:raw', (file: string, staged: boolean) => {
        requireRepo()
        return getRawPatch(file as string, staged as boolean)
    })
    handle('patch:apply', (patch: string, target: 'index' | 'worktree', reverse: boolean) => {
        requireRepo()
        return applyPatch(patch as string, target as 'index' | 'worktree', reverse as boolean)
    })
    handle('patch:stageHunks', (file: string, stagedView: boolean, hunks: number[], reverse: boolean) => {
        requireRepo()
        return stageHunks(file as string, stagedView as boolean, hunks as number[], reverse as boolean)
    })
    handle('file:history', (file: string) => {
        requireRepo()
        return getFileHistory(file as string)
    })
    handle('file:blame', (file: string) => {
        requireRepo()
        return getBlame(file as string)
    })
    handle('bisect:start', (bad: string, good?: string) => {
        requireRepo()
        return bisectStart(bad as string, good as string | undefined)
    })
    handle('bisect:mark', (kind: 'good' | 'bad' | 'skip') => {
        requireRepo()
        return bisectMark(kind as 'good' | 'bad' | 'skip')
    })
    handle('bisect:reset', () => {
        requireRepo()
        return bisectReset()
    })
    handle('worktree:listAll', () => {
        requireRepo()
        return listWorktrees()
    })
    handle('worktree:addNew', (dir: string, branch?: string) => {
        requireRepo()
        return addWorktree(dir as string, branch as string | undefined)
    })
    handle('worktree:removeOne', (dir: string) => {
        requireRepo()
        return removeWorktree(dir as string)
    })
    handle('submodule:list', () => {
        requireRepo()
        return listSubmodules()
    })
    handle('submodule:update', () => {
        requireRepo()
        return updateSubmodules()
    })

    /* ---- stash ---- */
    handle('stash:list', () => {
        requireRepo()
        return listStashes()
    })
    handle('stash:create', (message: string, includeUntracked: boolean) => {
        requireRepo()
        return createStash(message as string, includeUntracked as boolean)
    })
    handle('stash:apply', (index: number, pop: boolean) => {
        requireRepo()
        return applyStash(index as number, pop as boolean)
    })
    handle('stash:drop', (index: number) => {
        requireRepo()
        return dropStash(index as number)
    })

    /* recent repos persisted in userData/recent.json */
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
    handle('recent:remove', (_p: string) => {
        const file = path.join(app.getPath('userData'), 'recent.json')
        let list: string[] = []
        try {
            list = JSON.parse(fs.readFileSync(file, 'utf8')) as string[]
        } catch {}
        list = list.filter(x => x !== _p)
        fs.writeFileSync(file, JSON.stringify(list))
        return true
    })

    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
