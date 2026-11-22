import type { SimpleGit } from 'simple-git'

/**
 * Module-level state shared by the git slices. Kept free of feature logic (and of every other git module) so the slices that own the
 * behaviour can import it without creating cycles — repo close, the repo watcher and the undo journal all clear entries here.
 */

export const repoInstances = new Map<string, SimpleGit>()

export let activeRepoPath: string | null = null

export function setActiveRepoPath(next: string | null): void {
    activeRepoPath = next
}

/**
 * Whether a repo has any remote - expensive to ask (`git remote` spawn) and only changes when `.git/config` does, which the repo watcher
 * already sees. Invalidated on config writes and remote mutations, cleared when the repo closes so a reopen re-checks.
 */
export const hasRemoteCache = new Map<string, boolean>()

/** Original HEAD per repo path while an interactive rebase is paused, so completion can be journaled for Undo. */
export const interactiveRebases = new Map<string, string>()

/**
 * Undo journal state for risky operations (commit/amend/reset/drop-stash). Each entry remembers the pre-op state explicitly; the reflog is
 * only the backstop — git never GCs the objects promptly, so restoring a remembered ref is always safe. Keyed by repo path (never the
 * mutable active repo) so a tab switch mid-flight can't undo the wrong repository.
 */
export type UndoKind = 'commit' | 'reset' | 'branchTip' | 'dropStash'

export interface UndoEntry {
    id: number
    label: string
    doneMessage: string
    repoPath: string
    kind: UndoKind
    headBefore?: string
    resetMode?: 'soft' | 'mixed' | 'hard'
    /** Branch ref moved without touching the worktree (e.g. fast-forward merge into another branch). */
    ref?: string
    oldTip?: string
    /** Expected current tip — the undo refuses to run when the ref moved on (compare-and-swap). */
    newTip?: string
    stashHash?: string
    stashMessage?: string
}

export const undoStacks = new Map<string, UndoEntry[]>()

let undoId = 0

export function allocateUndoId(): number {
    return ++undoId
}
