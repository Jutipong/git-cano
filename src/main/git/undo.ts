import { getRepo, getRepoFor } from './repo'
import { allocateUndoId, undoStacks, type UndoEntry } from './state'

import type { UndoPreview } from '@shared/types'

/** Undo journal slice — see state.ts for the entry shape and why the journal is per repo path. */

const UNDO_STACK_LIMIT = 10

export function pushUndo(entry: Omit<UndoEntry, 'id'>): void {
    const stack = undoStacks.get(entry.repoPath) ?? []
    stack.push({ ...entry, id: allocateUndoId() })
    while (stack.length > UNDO_STACK_LIMIT) stack.shift()
    undoStacks.set(entry.repoPath, stack)
}

function undoStackFor(dir?: string): { repoPath: string; stack: UndoEntry[] } | null {
    let repoPath: string
    try {
        repoPath = dir ? getRepoFor(dir).path : getRepo().path
    } catch {
        return null
    }
    return { repoPath, stack: undoStacks.get(repoPath) ?? [] }
}

/** Latest undoable action for a repo, without consuming it. */
export function peekUndo(dir?: string): UndoPreview | null {
    const found = undoStackFor(dir)
    const top = found?.stack.at(-1)
    return top ? { id: top.id, label: top.label } : null
}

/**
 * Undoes the latest journal entry, but only when `id` still matches the top — a stale toast (another operation landed meanwhile) fails
 * loudly instead of undoing the wrong action.
 */
export async function undoById(id: number, dir?: string): Promise<string> {
    const found = undoStackFor(dir)
    const top = found?.stack.at(-1)
    if (!found || !top || top.id !== id) throw new Error('Nothing to undo — the action expired')
    const { git: g } = getRepoFor(top.repoPath)
    // Destructive restores refuse while new uncommitted work exists — checked BEFORE the pop
    // so the user can stash/commit and retry the same Undo toast.
    if (top.kind === 'reset' && top.resetMode === 'hard' && (await g.status()).files.length > 0) {
        throw new Error('Commit or stash your changes first — undo would discard them')
    }
    if (top.kind === 'branchTip') {
        const branch = (top.ref as string).replace(/^refs\/heads\//, '')
        const status = await g.status()
        if (status.current === branch && status.files.length > 0) {
            throw new Error('Commit or stash your changes first — undo would discard them')
        }
    }
    found.stack.pop()
    switch (top.kind) {
        case 'commit':
            await g.raw(['reset', '--soft', top.headBefore as string])
            return top.doneMessage
        case 'reset':
            // Hard resets themselves are never journaled — a hard restore here always belongs to
            // a rebase / cherry-pick / merge undo, which started from a clean tree.
            await g.raw(['reset', `--${top.resetMode as string}`, top.headBefore as string])
            return top.doneMessage
        case 'branchTip':
            // Compare-and-swap: refuses when the ref moved on since the merge.
            await g.raw(['update-ref', top.ref as string, top.oldTip as string, top.newTip as string])
            return top.doneMessage
        case 'dropStash':
            await g.raw(['stash', 'store', '-m', top.stashMessage as string, top.stashHash as string])
            return top.doneMessage
    }
}
