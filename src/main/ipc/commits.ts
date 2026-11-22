import { checkoutCommit, commitMessage, peekUndo, revertCommit, undoById } from '../git'
import { handleRepo } from './core'

/** Commit-action IPC: commit/amend, revert, detached checkout and the undo toast journal. */

export function registerCommitsIpc(): void {
    handleRepo('commit:revert', (hash: string) => revertCommit(hash as string))
    handleRepo('commit:checkout', (hash: string) => checkoutCommit(hash as string))
    handleRepo('commit:message', (message: string, amend: boolean, _dir?: string) =>
        commitMessage(message as string, amend as boolean, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    )
    handleRepo('git:undoPeek', (_dir?: string) => peekUndo(typeof _dir === 'string' && _dir ? (_dir as string) : undefined))
    handleRepo('git:undo', (id: number, _dir?: string) =>
        undoById(id as number, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    )
}
