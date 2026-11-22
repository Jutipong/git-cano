import {
    abortMerge,
    checkCherryPickConflicts,
    cherryPick,
    cherryPickAbort,
    cherryPickContinue,
    checkoutSide,
    conflictVersions,
    continueMerge,
    getRepoState,
    markResolved,
    readConflictFile,
    rebaseAbort,
    rebaseContinue,
    saveResolvedFile,
} from '../git'
import { handleRepo } from './core'

/** Conflict-flow IPC: merge/rebase/cherry-pick state, resolution helpers and continue/abort. */

export function registerConflictsIpc(): void {
    handleRepo('repo:state', () => getRepoState())
    handleRepo('conflict:side', (file: string, side: 'ours' | 'theirs') => checkoutSide(file as string, side as 'ours' | 'theirs'))
    handleRepo('conflict:resolved', (files: string[]) => markResolved(files as string[]))
    handleRepo('conflict:read', (file: string) => readConflictFile(file as string))
    handleRepo('conflict:versions', (file: string) => conflictVersions(file as string))
    handleRepo('conflict:save', (file: string, content: string) => saveResolvedFile(file as string, content as string))
    handleRepo('merge:continue', () => continueMerge())
    handleRepo('merge:abort', () => abortMerge())
    handleRepo('rebase:abort', () => rebaseAbort())
    handleRepo('rebase:continue', () => rebaseContinue())
    handleRepo('commit:cherryPick', (hash: string) => cherryPick(hash as string))
    handleRepo('commit:cherryPickCheck', (hash: string, target: string) => checkCherryPickConflicts(hash as string, target as string))
    handleRepo('cherryPick:continue', () => cherryPickContinue())
    handleRepo('cherryPick:abort', () => cherryPickAbort())
}
