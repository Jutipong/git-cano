import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  checkout,
  closeRepo,
  commit,
  createBranch,
  deleteBranch,
  discard,
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
  executeRebase,
  listBranches,
  merge,
  openRepo,
  pull,
  push,
  stage,
  stageAll,
  unstage,
  unstageAll,
} from './git'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'GitKraken X',
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
  handle('repo:status', () => {
    requireRepo()
    return getStatus()
  })
  handle('repo:close', () => {
    closeRepo()
    return true
  })
  handle('repo:openInTerminal', async () => {
    requireRepo()
    const dir = getStatus && (await getStatus()).path
    shell.openPath(dir)
    return true
  })

  /* ---- log / diff ---- */
  handle('repo:log', () => {
    requireRepo()
    return getLog()
  })
  handle('file:diff', (file: string, staged: boolean) => {
    requireRepo()
    return getDiff(file as string, staged as boolean)
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
  handle(
    'rebase:execute',
    (ref: string, entries: { command: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'; hash: string; message?: string }[]) => {
      requireRepo()
      return executeRebase(entries as never[], ref as string)
    },
  )
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
    list = [String(_p), ...list.filter((x) => x !== _p)].slice(0, 10)
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
