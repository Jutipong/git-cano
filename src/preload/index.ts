import { contextBridge, ipcRenderer } from 'electron'

import type { BranchInfo, CommitDetails, CommitNode, DiffLine, RepoStatus, RebaseEntry, StashEntry } from '@shared/types'

/** Unwrap errors sent as {__error} from main */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    const res = await ipcRenderer.invoke(channel, ...args)
    if (res && typeof res === 'object' && '__error' in res) throw new Error((res as { __error: string }).__error)
    return res as T
}

const api = {
    /* repo */
    pickAndOpen: (): Promise<RepoStatus | null> => call('repo:pickAndOpen'),
    init: (): Promise<RepoStatus | null> => call('repo:init'),
    clone: (url: string): Promise<RepoStatus | null> => call('repo:clone', url),
    openPath: (dir: string): Promise<RepoStatus> => call('repo:openPath', dir),
    setActiveRepo: (dir: string): Promise<void> => call('repo:setActive', dir),
    listRepos: (): Promise<string[]> => call('repo:list'),
    closeRepo: (dir?: string): Promise<boolean> => call('repo:close', dir),
    status: (): Promise<RepoStatus> => call('repo:status'),
    log: (limit?: number): Promise<CommitNode[]> => call('repo:log', limit),
    commitDetails: (hash: string): Promise<CommitDetails> => call('commit:details', hash),
    revertCommit: (hash: string): Promise<void> => call('commit:revert', hash),
    checkoutCommit: (hash: string): Promise<void> => call('commit:checkout', hash),
    repoState: (): Promise<{ merging: boolean; rebasing: boolean; bisectActive: boolean }> => call('repo:state'),
    conflictTakeSide: (file: string, side: 'ours' | 'theirs'): Promise<void> => call('conflict:side', file, side),
    markResolved: (files: string[]): Promise<void> => call('conflict:resolved', files),
    continueMerge: (): Promise<void> => call('merge:continue'),
    abortMerge: (): Promise<void> => call('merge:abort'),
    rebaseOnto: (ref: string): Promise<string> => call('rebase:onto', ref),
    rebaseAbort: (): Promise<void> => call('rebase:abort'),
    rebaseContinue: (): Promise<void> => call('rebase:continue'),
    rebasePlan: (ref: string): Promise<CommitNode[]> => call('rebase:plan', ref),
    rebaseExecute: (baseRef: string, entries: RebaseEntry[], resume?: boolean): Promise<{ completed: boolean; message: string }> =>
        call('rebase:execute', baseRef, entries, Boolean(resume)),
    rebaseAbortPaused: (): Promise<void> => call('rebase:abortPaused'),
    cherryPick: (hash: string): Promise<void> => call('commit:cherryPick', hash),
    resetTo: (target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> => call('ref:reset', target, mode),
    renameBranch: (oldName: string, newName: string): Promise<void> => call('branch:rename', oldName, newName),
    commitFileDiff: (hash: string, file: string): Promise<DiffLine[]> => call('file:commitDiff', hash, file),

    /* files */
    diff: (file: string, staged: boolean): Promise<DiffLine[]> => call('file:diff', file, staged),
    diffMeta: (file: string, staged: boolean): Promise<{ binary: boolean; image: boolean }> => call('file:diffMeta', file, staged),
    imageVersion: (file: string, source: 'workdir' | 'index' | 'head'): Promise<string | null> => call('file:image', file, source),
    stage: (paths: string[]): Promise<void> => call('file:stage', paths),
    stageAll: (): Promise<void> => call('file:stageAll'),
    unstage: (paths: string[]): Promise<void> => call('file:unstage', paths),
    unstageAll: (): Promise<void> => call('file:unstageAll'),
    discardFile: (p: string): Promise<void> => call('file:discard', p),
    discardAll: (): Promise<void> => call('file:discardAll'),

    /* commit */
    commit: (msg: string): Promise<string> => call('commit:create', msg),
    commitWithAmend: (msg: string, amend: boolean): Promise<string> => call('commit:message', msg, amend),
    lastCommitMessage: (): Promise<string> => call('commit:lastMessage'),

    /* branches */
    branches: (): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> => call('branch:list'),
    createBranch: (name: string, checkout: boolean): Promise<void> => call('branch:create', name, checkout),
    checkout: (ref: string): Promise<void> => call('branch:checkout', ref),
    deleteBranch: (name: string): Promise<void> => call('branch:delete', name),
    mergeBranch: (name: string): Promise<string> => call('branch:merge', name),

    /* remotes */
    fetch: (): Promise<string> => call('remote:fetch'),
    push: (): Promise<string> => call('remote:push'),
    pull: (): Promise<string> => call('remote:pull'),
    hasRemote: (): Promise<boolean> => call('remote:has'),

    /* stash */
    stashes: (): Promise<StashEntry[]> => call('stash:list'),
    createStash: (message: string, includeUntracked: boolean): Promise<void> => call('stash:create', message, includeUntracked),
    applyStash: (index: number, pop: boolean): Promise<void> => call('stash:apply', index, pop),
    dropStash: (index: number): Promise<void> => call('stash:drop', index),

    /* tags */
    tags: (): Promise<{ name: string; hash: string }[]> => call('tag:list'),
    createTag: (name: string, hash?: string | null, message?: string): Promise<void> => call('tag:create', name, hash ?? null, message),
    deleteTag: (name: string): Promise<void> => call('tag:delete', name),
    pushTags: (): Promise<string> => call('tag:push'),

    /* remotes management */
    remotesFull: (): Promise<{ name: string; url: string }[]> => call('remote:listFull'),
    addRemote: (name: string, url: string): Promise<void> => call('remote:addNew', name, url),
    removeRemote: (name: string): Promise<void> => call('remote:removeOne', name),
    setRemoteUrl: (name: string, url: string): Promise<void> => call('remote:setUrl', name, url),

    /* partial staging */
    rawPatch: (file: string, staged: boolean): Promise<string> => call('patch:raw', file, staged),
    applyPatch: (patch: string, target: 'index' | 'worktree', reverse: boolean): Promise<void> =>
        call('patch:apply', patch, target, reverse),
    stageHunks: (file: string, stagedView: boolean, hunks: number[], reverse: boolean): Promise<void> =>
        call('patch:stageHunks', file, stagedView, hunks, reverse),

    /* blame & history */
    fileHistory: (file: string): Promise<CommitNode[]> => call('file:history', file),
    blame: (file: string): Promise<{ hash: string; author: string; date: string; lineNumber: number; content: string }[]> =>
        call('file:blame', file),

    /* bisect */
    bisectStart: (bad: string, good?: string): Promise<void> => call('bisect:start', bad, good),
    bisectMark: (kind: 'good' | 'bad' | 'skip'): Promise<void> => call('bisect:mark', kind),
    bisectReset: (): Promise<void> => call('bisect:reset'),

    /* worktrees & submodules */
    worktrees: (): Promise<{ path: string; head: string; branch: string | null }[]> => call('worktree:listAll'),
    addWorktree: (dir: string, branch?: string): Promise<void> => call('worktree:addNew', dir, branch),
    removeWorktree: (dir: string): Promise<void> => call('worktree:removeOne', dir),
    submodules: (): Promise<string[]> => call('submodule:list'),
    updateSubmodules: (): Promise<string> => call('submodule:update'),

    /* recent */
    recentList: (): Promise<string[]> => call('recent:list'),
    recentAdd: (p: string): Promise<boolean> => call('recent:add', p),
    recentRemove: (p: string): Promise<boolean> => call('recent:remove', p),
    /* external repo change notifications (main-process .git watcher) */
    onRepoChanged: (callback: (repoPath: string) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, repoPath: string) => callback(repoPath)
        ipcRenderer.on('repo:changed', listener)
        return () => ipcRenderer.removeListener('repo:changed', listener)
    },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
