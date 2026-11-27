import * as path from 'node:path'

import { dialog } from 'electron'

import { cloneFolderError, extractRepoFolderName, isValidCloneFolderName, sanitizeCloneFolderName } from '@shared/clone'

import { authGitEnv } from '../auth'
import {
    NotARepoError,
    baseEnv,
    closeRepo,
    getActiveRepoPath,
    getStatus,
    initRepo,
    isOpen,
    openRepo,
    plainGit,
    setActiveRepo,
} from '../git'
import { openStartDir, startDir, writeAppSettings } from './app'
import { handle, handleRepo } from './core'

/** Repository lifecycle slice: open/init/clone/activate/close. */

export function registerRepoIpc(): void {
    handle('repo:pickAndOpen', async () => {
        const res = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: openStartDir() })
        if (res.canceled || !res.filePaths[0]) return null
        const dir = res.filePaths[0]
        writeAppSettings({ lastOpenRoot: path.dirname(dir) })
        try {
            return { kind: 'opened', status: await openRepo(dir) }
        } catch (error) {
            // Only a truly unversioned folder reaches the renderer as an init offer — permission/corruption errors still surface as errors.
            if (error instanceof NotARepoError) return { kind: 'needsInit', dir }
            throw error
        }
    })
    handle('repo:init', (_dir: string) => initRepo(String(_dir ?? '')))
    handle('repo:pickDir', async () => {
        const res = await dialog.showOpenDialog({
            title: 'Choose destination folder for clone',
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: startDir(),
        })
        if (res.canceled || !res.filePaths[0]) return null
        return res.filePaths[0]
    })
    handle('repo:clone', async (_url: string, _parent?: string, _folder?: string) => {
        const url = String(_url ?? '').trim()
        if (!url) throw new Error('Repository URL is required')
        let parent = typeof _parent === 'string' ? _parent.trim() : ''
        if (!parent) {
            const res = await dialog.showOpenDialog({
                title: 'Choose destination folder',
                properties: ['openDirectory', 'createDirectory'],
                defaultPath: startDir(),
            })
            if (res.canceled || !res.filePaths[0]) return null
            parent = res.filePaths[0]
        }
        let folder = typeof _folder === 'string' ? sanitizeCloneFolderName(_folder) : ''
        if (!folder) folder = extractRepoFolderName(url) || path.basename(url, '.git')
        if (!isValidCloneFolderName(folder)) throw new Error(cloneFolderError(folder) || 'Invalid folder name')
        const destPath = path.join(parent, folder)
        const g = plainGit()
        g.env({ ...baseEnv(), ...authGitEnv() })
        await g.clone(url, destPath)
        writeAppSettings({ lastCloneRoot: parent })
        return openRepo(destPath)
    })
    handle('repo:openPath', (_dir: string) => openRepo(_dir as string))
    handle('repo:setActive', (_dir: string) => setActiveRepo(_dir as string))
    handleRepo('repo:status', () => getStatus())
    handle('repo:close', (_dir?: string) => {
        // Resolve the target exactly like closeRepo() does, so a no-arg close releases the right instance.
        const target = typeof _dir === 'string' && _dir ? _dir : getActiveRepoPath()
        closeRepo(target ?? undefined)
        return isOpen()
    })
}
