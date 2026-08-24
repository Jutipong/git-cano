import { contextBridge, ipcRenderer } from 'electron'
import type { CommitDetails, CommitNode, DiffLine, RepoStatus, StashEntry } from '@shared/types'
/** unwrap errors sent as {__error} from main */
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
  status: (): Promise<RepoStatus> => call('repo:status'),
  log: (): Promise<CommitNode[]> => call('repo:log'),
  commitDetails: (hash: string): Promise<CommitDetails> => call('commit:details', hash),
  revertCommit: (hash: string): Promise<void> => call('commit:revert', hash),
  checkoutCommit: (hash: string): Promise<void> => call('commit:checkout', hash),
  repoState: (): Promise<{ merging: boolean; rebasing: boolean }> => call('repo:state'),
  conflictTakeSide: (file: string, side: 'ours' | 'theirs'): Promise<void> => call('conflict:side', file, side),
  markResolved: (files: string[]): Promise<void> => call('conflict:resolved', files),
  continueMerge: (): Promise<void> => call('merge:continue'),
  abortMerge: (): Promise<void> => call('merge:abort'),
  rebaseOnto: (ref: string): Promise<string> => call('rebase:onto', ref),
  rebaseAbort: (): Promise<void> => call('rebase:abort'),
  rebaseContinue: (): Promise<void> => call('rebase:continue'),
  rebasePlan: (ref: string): Promise<CommitNode[]> => call('rebase:plan', ref),
  rebaseExecute: (
    baseRef: string,
    entries: { command: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'; hash: string; message?: string }[],
  ): Promise<string> => call('rebase:execute', baseRef, entries),
  cherryPick: (hash: string): Promise<void> => call('commit:cherryPick', hash),
  resetTo: (target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> => call('ref:reset', target, mode),
  renameBranch: (oldName: string, newName: string): Promise<void> => call('branch:rename', oldName, newName),
  commitFileDiff: (hash: string, file: string): Promise<DiffLine[]> => call('file:commitDiff', hash, file),

  /* files */
  diff: (file: string, staged: boolean): Promise<DiffLine[]> => call('file:diff', file, staged),
  stage: (paths: string[]): Promise<void> => call('file:stage', paths),
  stageAll: (): Promise<void> => call('file:stageAll'),
  unstage: (paths: string[]): Promise<void> => call('file:unstage', paths),
  unstageAll: (): Promise<void> => call('file:unstageAll'),
  discardFile: (p: string): Promise<void> => call('file:discard', p),

  /* commit */
  commit: (msg: string): Promise<string> => call('commit:create', msg),

  /* branches */
  branches: (): Promise<{ local: { name: string; current: boolean }[]; remote: { name: string; current: boolean }[] }> =>
    call('branch:list'),
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

  /* recent */
  recentList: (): Promise<string[]> => call('recent:list'),
  recentAdd: (p: string): Promise<boolean> => call('recent:add', p),
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
