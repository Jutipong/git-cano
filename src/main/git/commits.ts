import { getRepo, getRepoFor } from './repo'
import { pushUndo } from './undo'

/** Commit-action slice: commit/amend with undo journaling, revert and detached checkout. */

export async function revertCommit(hash: string): Promise<void> {
    const { path: p, git: g } = getRepo()
    const headBefore = await g
        .revparse(['HEAD'])
        .then(out => out.trim())
        .catch(() => null)
    await g.raw(['revert', '--no-edit', hash])
    // A revert only appends a commit, so restoring the pointer is always lossless.
    if (headBefore) {
        pushUndo({ label: 'revert', doneMessage: 'Revert undone', repoPath: p, kind: 'commit', headBefore })
    }
}

export async function checkoutCommit(hash: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(hash)
}

export async function commitMessage(message: string, amend: boolean, dir?: string): Promise<string> {
    const { path: p, git: g } = dir ? getRepoFor(dir) : getRepo()
    if (amend && !message.trim()) throw new Error('Enter a message to amend with')
    // Unborn HEAD (first-ever commit) has nothing to restore — skip the journal then.
    const headBefore = await g
        .revparse(['HEAD'])
        .then(out => out.trim())
        .catch(() => null)
    const res = amend ? await g.commit(message, undefined, { '--amend': null }) : await g.commit(message)
    if (headBefore) {
        pushUndo({
            label: amend ? 'amend' : 'commit',
            doneMessage: amend ? 'Amend undone' : 'Commit undone',
            repoPath: p,
            kind: 'commit',
            headBefore,
        })
    }
    return res.commit
}
