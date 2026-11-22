import {
    checkMergeConflicts,
    checkoutRemoteWithOptions,
    checkoutWithOptions,
    createBranchWithOptions,
    deleteBranch,
    deleteRemoteBranch,
    getCachedBranches,
    listBranches,
    listSoloFiles,
    mergeInto,
    pullBranch,
    pushBranch,
    resetTo,
} from '../git'
import { handleRepo } from './core'

import type { LocalChangesMode, MergeMode } from '@shared/types'

/** Branch slice IPC: list/create/checkout/delete, merge checks and branch-level push/pull/reset. */

export function registerBranchesIpc(): void {
    handleRepo('branch:list', () => listBranches())
    handleRepo('branch:cached', () => getCachedBranches())
    handleRepo('branch:soloFiles', (branch?: string, _limit?: number) =>
        listSoloFiles(branch as string, typeof _limit === 'number' ? _limit : 500)
    )
    handleRepo('branch:create', (name: string, co: boolean, startPoint?: string, localChanges?: LocalChangesMode) =>
        createBranchWithOptions(name as string, co as boolean, (localChanges as LocalChangesMode) || 'keep', startPoint)
    )
    handleRepo('branch:checkout', (ref: string, localChanges?: LocalChangesMode) =>
        checkoutWithOptions(ref as string, (localChanges as LocalChangesMode) || 'keep')
    )
    handleRepo('branch:checkoutRemote', (ref: string, localChanges?: LocalChangesMode) =>
        checkoutRemoteWithOptions(ref as string, (localChanges as LocalChangesMode) || 'keep')
    )
    handleRepo('branch:delete', (name: string) => deleteBranch(name as string))
    handleRepo('branch:remoteDelete', (ref: string) => deleteRemoteBranch(ref as string))
    handleRepo('branch:mergeCheck', (source: string, target: string) => checkMergeConflicts(source as string, target as string))
    handleRepo('branch:mergeInto', (source: string, target: string, mode: MergeMode = 'default') =>
        mergeInto(source as string, target as string, mode as MergeMode)
    )
    handleRepo('branch:push', (name: string, force: boolean) => pushBranch(name as string, force as boolean))
    handleRepo('branch:pull', (name: string) => pullBranch(name as string))
    handleRepo('ref:reset', (target: string, mode: 'soft' | 'mixed' | 'hard') => resetTo(target as string, mode as 'soft' | 'mixed' | 'hard'))
}
