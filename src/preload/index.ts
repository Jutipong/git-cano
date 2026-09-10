import { contextBridge, ipcRenderer } from 'electron'

import type {
    AiConfig,
    AiContextScope,
    AiProvider,
    AiTestResult,
    AuthConfig,
    BlameLine,
    BranchInfo,
    CommitDetails,
    CommitFile,
    CommitNode,
    ConflictVersions,
    DiffLine,
    DiffMeta,
    GithubUser,
    GoModel,
    MergeCheck,
    RemoteTestResult,
    RepoStatus,
    RebaseEntry,
    ReflogEntry,
    SquashPlan,
    SshKeyInfo,
    SshTestResult,
    StashEntry,
    UndoPreview,
    LocalChangesMode,
    OpenInTargets,
    RepoState,
} from '@shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
    const res = await ipcRenderer.invoke(channel, ...args)
    if (res && typeof res === 'object' && '__error' in res) throw new Error((res as { __error: string }).__error)
    return res as T
}

const api = {
    pickAndOpen: (): Promise<RepoStatus | null> => call('repo:pickAndOpen'),
    init: (): Promise<RepoStatus | null> => call('repo:init'),
    pickDirectory: (): Promise<string | null> => call('repo:pickDir'),
    clone: (url: string, dest?: string): Promise<RepoStatus | null> => call('repo:clone', url, dest),
    openPath: (dir: string): Promise<RepoStatus> => call('repo:openPath', dir),
    setActiveRepo: (dir: string): Promise<void> => call('repo:setActive', dir),
    listRepos: (): Promise<string[]> => call('repo:list'),
    closeRepo: (dir?: string): Promise<boolean> => call('repo:close', dir),
    openTerminal: (dir: string): Promise<void> => call('app:openTerminal', dir),
    openInFolder: (dir: string): Promise<void> => call('app:openInFolder', dir),
    openInVSCode: (dir: string): Promise<void> => call('app:openInVSCode', dir),
    openInKiro: (dir: string): Promise<void> => call('app:openInKiro', dir),
    getOpenInTargets: (dir: string): Promise<OpenInTargets> => call('app:getOpenInTargets', dir),
    openInRider: (dir: string): Promise<void> => call('app:openInRider', dir),
    openInVisualStudio: (dir: string): Promise<void> => call('app:openInVisualStudio', dir),
    getVersion: (): Promise<string> => call('app:getVersion'),
    getStatusAccelerators: (): Promise<boolean> => call('app:getStatusAccelerators'),
    setStatusAccelerators: (enabled: boolean): Promise<boolean> => call('app:setStatusAccelerators', enabled),
    getDefaultOpenDir: (): Promise<string> => call('app:getDefaultOpenDir'),
    setDefaultOpenDir: (dir: string): Promise<boolean> => call('app:setDefaultOpenDir', dir),
    status: (): Promise<RepoStatus> => call('repo:status'),
    log: (limit?: number): Promise<CommitNode[]> => call('repo:log', limit),
    logCached: (limit?: number): Promise<CommitNode[] | null> => call('repo:logCached', limit),
    logPage: (offset: number, limit: number): Promise<CommitNode[]> => call('repo:logPage', offset, limit),
    logSolo: (branch: string, limit?: number): Promise<CommitNode[]> => call('repo:logSolo', branch, limit),
    logSoloPage: (branch: string, offset: number, limit: number): Promise<CommitNode[]> => call('repo:logSoloPage', branch, offset, limit),
    commitDetails: (hash: string): Promise<CommitDetails> => call('commit:details', hash),
    revertCommit: (hash: string): Promise<void> => call('commit:revert', hash),
    checkoutCommit: (hash: string): Promise<void> => call('commit:checkout', hash),
    repoState: (): Promise<RepoState> => call('repo:state'),
    conflictTakeSide: (file: string, side: 'ours' | 'theirs'): Promise<void> => call('conflict:side', file, side),
    markResolved: (files: string[]): Promise<void> => call('conflict:resolved', files),
    readConflictFile: (file: string): Promise<string | null> => call('conflict:read', file),
    conflictVersions: (file: string): Promise<ConflictVersions> => call('conflict:versions', file),
    saveResolvedFile: (file: string, content: string): Promise<void> => call('conflict:save', file, content),
    continueMerge: (): Promise<void> => call('merge:continue'),
    abortMerge: (): Promise<void> => call('merge:abort'),
    rebaseOnto: (ref: string): Promise<string> => call('rebase:onto', ref),
    rebaseAbort: (): Promise<void> => call('rebase:abort'),
    rebaseContinue: (): Promise<void> => call('rebase:continue'),
    rebasePlan: (ref: string): Promise<CommitNode[]> => call('rebase:plan', ref),
    rebaseExecute: (baseRef: string, entries: RebaseEntry[], resume?: boolean): Promise<{ completed: boolean; message: string }> =>
        call('rebase:execute', baseRef, entries, Boolean(resume)),
    rebaseAbortPaused: (): Promise<void> => call('rebase:abortPaused'),
    squashPlan: (target: string): Promise<SquashPlan> => call('squash:plan', target),
    squashCommits: (base: string, message: string): Promise<string> => call('squash:run', base, message),
    reflog: (limit?: number): Promise<ReflogEntry[]> => call('reflog:list', limit),
    restoreReflog: (ref: string): Promise<string> => call('reflog:restore', ref),
    cherryPick: (hash: string): Promise<void> => call('commit:cherryPick', hash),
    cherryPickCheck: (hash: string, target: string): Promise<MergeCheck> => call('commit:cherryPickCheck', hash, target),
    cherryPickContinue: (): Promise<void> => call('cherryPick:continue'),
    cherryPickAbort: (): Promise<void> => call('cherryPick:abort'),
    resetTo: (target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> => call('ref:reset', target, mode),
    renameBranch: (oldName: string, newName: string): Promise<void> => call('branch:rename', oldName, newName),
    commitFileDiff: (hash: string, file: string, context?: number): Promise<DiffLine[]> => call('file:commitDiff', hash, file, context),
    getCommitFileMeta: (hash: string, file: string): Promise<DiffMeta> => call('file:commitMeta', hash, file),
    getCommitImageVersion: (hash: string, file: string): Promise<string | null> => call('file:commitImage', hash, file),
    listFiles: (commitHash?: string): Promise<string[]> => call('file:list', commitHash),
    addIgnoreRule: (rule: string): Promise<string> => call('file:addIgnoreRule', rule),

    diff: (file: string, staged: boolean, context?: number): Promise<DiffLine[]> => call('file:diff', file, staged, context),
    diffMeta: (file: string, staged: boolean): Promise<{ binary: boolean; image: boolean }> => call('file:diffMeta', file, staged),
    imageVersion: (file: string, source: 'workdir' | 'index' | 'head'): Promise<string | null> => call('file:image', file, source),
    stage: (paths: string[]): Promise<void> => call('file:stage', paths),
    stageAll: (repoPath?: string): Promise<void> => call('file:stageAll', repoPath),
    unstage: (paths: string[]): Promise<void> => call('file:unstage', paths),
    unstageAll: (): Promise<void> => call('file:unstageAll'),
    discardFile: (p: string): Promise<void> => call('file:discard', p),
    discardUnstaged: (): Promise<void> => call('file:discardUnstaged'),
    discardUntracked: (): Promise<void> => call('file:discardUntracked'),

    commit: (msg: string): Promise<string> => call('commit:create', msg),
    commitWithAmend: (msg: string, amend: boolean, repoPath?: string): Promise<string> => call('commit:message', msg, amend, repoPath),
    lastCommitMessage: (): Promise<string> => call('commit:lastMessage'),
    undoPeek: (repoPath?: string): Promise<UndoPreview | null> => call('git:undoPeek', repoPath ?? null),
    undoById: (id: number, repoPath?: string): Promise<string> => call('git:undo', id, repoPath ?? null),

    branches: (): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> => call('branch:list'),
    branchesCached: (): Promise<{ local: BranchInfo[]; remote: BranchInfo[] } | null> => call('branch:cached'),
    soloFiles: (branch: string, limit?: number): Promise<string[]> => call('branch:soloFiles', branch, limit),
    createBranch: (name: string, checkout: boolean, startPoint?: string, localChanges?: LocalChangesMode): Promise<void> =>
        call('branch:create', name, checkout, startPoint, localChanges),
    checkout: (ref: string, localChanges?: LocalChangesMode): Promise<void> => call('branch:checkout', ref, localChanges),
    checkoutRemote: (ref: string, localChanges?: LocalChangesMode): Promise<void> => call('branch:checkoutRemote', ref, localChanges),
    deleteBranch: (name: string): Promise<void> => call('branch:delete', name),
    deleteRemoteBranch: (ref: string): Promise<string> => call('branch:remoteDelete', ref),
    mergeCheckConflicts: (source: string, target: string): Promise<MergeCheck> => call('branch:mergeCheck', source, target),
    mergeInto: (source: string, target: string): Promise<string> => call('branch:mergeInto', source, target),
    pushBranch: (name: string, force = false): Promise<string> => call('branch:push', name, force),
    pullBranch: (name: string): Promise<string> => call('branch:pull', name),

    fetch: (): Promise<string> => call('remote:fetch'),
    push: (force = false, repoPath?: string): Promise<string> => call('remote:push', Boolean(force), repoPath),
    pull: (rebase = false): Promise<string> => call('remote:pull', Boolean(rebase)),
    hasRemote: (): Promise<boolean> => call('remote:has'),

    stashes: (): Promise<StashEntry[]> => call('stash:list'),
    createStash: (message: string): Promise<void> => call('stash:create', message),
    applyStash: (index: number, pop: boolean): Promise<void> => call('stash:apply', index, pop),
    dropStash: (index: number): Promise<void> => call('stash:drop', index),
    stashFiles: (hash: string): Promise<CommitFile[]> => call('stash:files', hash),
    stashFileDiff: (hash: string, file: string, context?: number): Promise<DiffLine[]> => call('stash:fileDiff', hash, file, context),
    stashFileMeta: (hash: string, file: string): Promise<DiffMeta> => call('stash:fileMeta', hash, file),
    stashImageVersion: (hash: string, file: string): Promise<string | null> => call('stash:imageVersion', hash, file),

    tags: (): Promise<{ name: string; hash: string }[]> => call('tag:list'),
    createTag: (name: string, hash?: string | null, message?: string): Promise<void> => call('tag:create', name, hash ?? null, message),
    deleteTag: (name: string): Promise<void> => call('tag:delete', name),
    pushTags: (): Promise<string> => call('tag:push'),
    pushTag: (name: string): Promise<string> => call('tag:pushOne', name),
    remoteTags: (): Promise<string[]> => call('tag:remoteList'),
    deleteRemoteTag: (name: string): Promise<string> => call('tag:remoteDelete', name),

    remotesFull: (): Promise<{ name: string; url: string }[]> => call('remote:listFull'),
    addRemote: (name: string, url: string): Promise<void> => call('remote:addNew', name, url),
    removeRemote: (name: string): Promise<void> => call('remote:removeOne', name),
    setRemoteUrl: (name: string, url: string): Promise<void> => call('remote:setUrl', name, url),
    testRemoteUrl: (url: string): Promise<RemoteTestResult> => call('remote:testUrl', url),

    rawPatch: (file: string, staged: boolean): Promise<string> => call('patch:raw', file, staged),
    applyPatch: (patch: string, target: 'index' | 'worktree', reverse: boolean): Promise<void> =>
        call('patch:apply', patch, target, reverse),
    stageHunks: (file: string, stagedView: boolean, hunks: number[], reverse: boolean): Promise<void> =>
        call('patch:stageHunks', file, stagedView, hunks, reverse),

    fileHistory: (file: string): Promise<CommitNode[]> => call('file:history', file),
    blame: (file: string, rev?: string): Promise<BlameLine[]> => call('file:blame', file, rev ?? null),

    bisectStart: (bad: string, good?: string): Promise<void> => call('bisect:start', bad, good),
    bisectMark: (kind: 'good' | 'bad' | 'skip'): Promise<void> => call('bisect:mark', kind),
    bisectReset: (): Promise<void> => call('bisect:reset'),

    worktrees: (): Promise<{ path: string; head: string; branch: string | null }[]> => call('worktree:listAll'),
    addWorktree: (dir: string, branch?: string): Promise<void> => call('worktree:addNew', dir, branch),
    removeWorktree: (dir: string): Promise<void> => call('worktree:removeOne', dir),
    submodules: (): Promise<string[]> => call('submodule:list'),
    updateSubmodules: (): Promise<string> => call('submodule:update'),

    recentList: (): Promise<string[]> => call('recent:list'),
    recentAdd: (p: string): Promise<boolean> => call('recent:add', p),
    recentRemove: (p: string): Promise<boolean> => call('recent:remove', p),

    clientLog: (level: 'info' | 'warn' | 'error', message: string): void => {
        ipcRenderer.send('app:log', level, message)
    },

    onRepoChanged: (callback: (repoPath: string) => void): (() => void) => {
        const listener = (_event: Electron.IpcRendererEvent, repoPath: string) => callback(repoPath)
        ipcRenderer.on('repo:changed', listener)
        return () => ipcRenderer.removeListener('repo:changed', listener)
    },

    ai: {
        getConfig: (): Promise<AiConfig> => call('ai:getConfig'),
        saveConfig: (cfg: AiConfig): Promise<void> => call('ai:saveConfig', cfg),
        test: (provider: AiProvider, token: string, modelId: string): Promise<AiTestResult> => call('ai:test', provider, token, modelId),
        generateCommitMessage: (formatFirst: boolean, scope: AiContextScope = 'staged', repoPath?: string): Promise<string> =>
            call('ai:generateCommitMessage', formatFirst, scope, repoPath),
        listModels: (provider: AiProvider, token: string): Promise<GoModel[]> => call('ai:listModels', provider, token),
        cancelGenerate: (repoPath?: string): Promise<boolean> => call('ai:cancelGenerate', repoPath),
    },

    auth: {
        getConfig: (): Promise<AuthConfig> => call('auth:getConfig'),
        saveConfig: (cfg: AuthConfig): Promise<AuthConfig> => call('auth:saveConfig', cfg),
        sshList: (): Promise<SshKeyInfo[]> => call('auth:ssh:list'),
        sshGenerate: (name: string, comment: string, passphrase: string): Promise<SshKeyInfo> =>
            call('auth:ssh:generate', name, comment, passphrase),
        sshTest: (keyPath: string): Promise<SshTestResult> => call('auth:ssh:test', keyPath),
        sshDelete: (keyPath: string): Promise<SshKeyInfo[]> => call('auth:ssh:delete', keyPath),
        openSshDir: (): Promise<string> => call('auth:ssh:openDir'),
        githubStatus: (): Promise<GithubUser | null> => call('auth:github:status'),
        githubRefresh: (): Promise<GithubUser | null> => call('auth:github:refresh'),
        githubVerify: (token: string): Promise<GithubUser> => call('auth:github:verify', token),
        openGithubTokenPage: (): Promise<void> => call('auth:github:openTokenPage'),
    },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
