import * as fs from 'node:fs'
import * as path from 'node:path'

import { log } from '../logger'
import { parseMergeTreeOutput } from '../parsers'
import { cleanupRebase, finishRebase, rebaseEditorEnv, rebaseInProgress, rebasePlanPath } from './rebase'
import { baseEnv, getRepo } from './repo'
import { interactiveRebases } from './state'
import { pushUndo } from './undo'
import { isBinaryFile } from './util'

import type { ConflictVersions, MergeCheck, RebaseContinueResult, RepoState } from '@shared/types'

/** Conflict-flow slice: merge/rebase/cherry-pick state, conflict file stages and the continue/abort endings. */

/** Branch (or short hash) being merged in — parsed from MERGE_MSG/MERGE_HEAD. */
function mergeSourceName(gitDir: string): string | null {
    const msgPath = path.join(gitDir, 'MERGE_MSG')
    if (fs.existsSync(msgPath)) {
        const firstLine = fs.readFileSync(msgPath, 'utf8').split('\n')[0] ?? ''
        const match = firstLine.match(/^Merge (?:remote-tracking )?(?:branch|tag|commit) '([^']+)'/)
        if (match) return match[1]
    }
    const headPath = path.join(gitDir, 'MERGE_HEAD')
    if (fs.existsSync(headPath)) {
        const hash = fs.readFileSync(headPath, 'utf8').trim().slice(0, 7)
        if (hash) return hash
    }
    return null
}

/** Short hash of the commit being cherry-picked — read from CHERRY_PICK_HEAD. */
function cherryPickSourceName(gitDir: string): string | null {
    const headPath = path.join(gitDir, 'CHERRY_PICK_HEAD')
    if (fs.existsSync(headPath)) {
        const hash = fs.readFileSync(headPath, 'utf8').trim().slice(0, 7)
        if (hash) return hash
    }
    return null
}

export function getRepoState(): RepoState {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    const merging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
    const rebasing = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
    const cherryPicking = fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))
    return {
        merging,
        rebasing,
        cherryPicking,
        mergeSource: merging ? mergeSourceName(gitDir) : null,
        cherryPickSource: cherryPicking ? cherryPickSourceName(gitDir) : null,
    }
}

export async function checkoutSide(file: string, side: 'ours' | 'theirs'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file])
    await g.add(file)
}

/** Working-tree content of an unmerged file (contains conflict markers) — null when the file doesn't exist. */
export async function readConflictFile(file: string): Promise<string | null> {
    const { path: p } = getRepo()
    try {
        return await fs.promises.readFile(path.join(p, file), 'utf8')
    } catch {
        return null
    }
}

/**
 * The three unmerged stages of a conflicted file: `:1:` = base, `:2:` = ours, `:3:` = theirs. A missing stage (delete/modify conflicts)
 * returns null for that side; binary files return all-null content with `binary: true`.
 */
export async function conflictVersions(file: string): Promise<ConflictVersions> {
    const { path: p, git: g } = getRepo()
    if (isBinaryFile(p, file)) return { ours: null, base: null, theirs: null, binary: true }
    const readStage = async (n: number): Promise<string | null> => {
        try {
            return await g.raw(['show', `:${n}:${file}`])
        } catch {
            return null
        }
    }
    const [ours, base, theirs] = await Promise.all([readStage(2), readStage(1), readStage(3)])
    return { ours, base, theirs, binary: false }
}

/** Write the resolved content back to the working tree and stage the file (= resolved). */
export async function saveResolvedFile(file: string, content: string): Promise<void> {
    if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
        throw new Error('File still contains conflict markers')
    }
    const { path: p, git: g } = getRepo()
    await fs.promises.writeFile(path.join(p, file), content, 'utf8')
    await g.add(file)
}

export async function markResolved(files: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(files)
}

export async function continueMerge(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['commit', '--no-edit'])
}

export async function abortMerge(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['merge', '--abort'])
}

export async function rebaseAbort(): Promise<void> {
    const { path: p, git: g } = getRepo()
    g.env({ ...baseEnv(), GIT_EDITOR: 'true' })
    try {
        await g.raw(['rebase', '--abort'])
    } finally {
        g.env(baseEnv())
        cleanupRebase(p)
    }
}

export async function rebaseContinue(): Promise<RebaseContinueResult> {
    const { path: p, git: g } = getRepo()
    const origHead = interactiveRebases.get(p)
    const planFile = rebasePlanPath(p)
    // Keep the helper env while an interactive rebase is paused: later reword/squash steps still
    // need the message editor. A plain pull-rebase just keeps the non-interactive editor.
    g.env(origHead && fs.existsSync(planFile) ? rebaseEditorEnv(planFile) : { ...baseEnv(), GIT_EDITOR: 'true' })
    try {
        await g.raw(['rebase', '--continue'])
    } catch (error) {
        if (!rebaseInProgress(p)) {
            cleanupRebase(p)
            throw error
        }
        return { completed: false, undoable: false }
    } finally {
        g.env(baseEnv())
    }
    if (rebaseInProgress(p)) return { completed: false, undoable: false }
    if (origHead) finishRebase(p, origHead)
    else cleanupRebase(p)
    return { completed: true, undoable: Boolean(origHead) }
}

export async function cherryPick(hash: string): Promise<void> {
    const { path: p, git: g } = getRepo()
    const clean = (await g.status()).files.length === 0
    const headBefore = await g
        .revparse(['HEAD'])
        .then(out => out.trim())
        .catch(() => null)
    try {
        await g.raw(['cherry-pick', hash])
    } catch {
        if (getRepoState().cherryPicking) throw new Error('Cherry-pick stopped due to conflicts. Resolve them, then continue.')
        throw new Error('Cherry-pick failed')
    }
    if (clean && headBefore) {
        pushUndo({ label: 'cherry-pick', doneMessage: 'Cherry-pick undone', repoPath: p, kind: 'reset', headBefore, resetMode: 'hard' })
    }
}

/**
 * Dry-run cherry-pick check via `git merge-tree --write-tree` — simulates replaying `hash` onto `target` the same way `git cherry-pick`
 * would (ours = target tip, theirs = commit, base = the commit's parent). Requires git >= 2.38 with `--merge-base` support, otherwise
 * `supported: false`. Root commits have no parent to replay from, so they also report unsupported.
 *
 * Note: this only covers tree-level conflicts — a dirty worktree or untracked files can still fail the real pick.
 */
export async function checkCherryPickConflicts(hash: string, target: string): Promise<MergeCheck> {
    const { git: g } = getRepo()
    const rev = hash.trim()
    const tip = target.trim()
    if (!rev || !tip) throw new Error('A commit and a branch are required')
    let parents = ''
    try {
        parents = (await g.raw(['show', '-s', '--format=%P', rev])).trim()
    } catch {
        throw new Error(`Unknown commit: ${rev.slice(0, 7)}`)
    }
    const base = parents.split(/\s+/).filter(Boolean)[0]
    if (!base) return { supported: false, fastForward: false, conflicts: [] }
    try {
        const [mergeBase, targetHead] = await Promise.all([
            g.raw(['merge-base', tip, rev]).then(
                out => out.trim(),
                () => ''
            ),
            g.raw(['rev-parse', '--verify', tip]).then(
                out => out.trim(),
                () => ''
            ),
        ])
        // Already an ancestor of the target — the real pick would come out empty.
        if (mergeBase && targetHead && (mergeBase === rev || mergeBase.startsWith(rev))) {
            return { supported: true, fastForward: true, conflicts: [] }
        }
    } catch {}
    let stdout = ''
    try {
        stdout = await g.raw(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, tip, rev])
    } catch (error) {
        const err = error as { git?: { stdout?: string }; message?: string }
        stdout = err.git?.stdout ?? ''
        if (!stdout) {
            const text = err.message ?? ''
            if (!/unknown option|unrecognized|usage: git merge-tree/i.test(text)) {
                log('warn', 'git', `cherry-pick check failed: ${text.split('\n')[0]}`)
            }
            return { supported: false, fastForward: false, conflicts: [] }
        }
    }
    return parseMergeTreeOutput(stdout)
}

export async function cherryPickContinue(): Promise<void> {
    const { git: g } = getRepo()
    g.env({ ...baseEnv(), GIT_EDITOR: 'true' })
    try {
        await g.raw(['cherry-pick', '--continue'])
    } finally {
        g.env(baseEnv())
    }
}

export async function cherryPickAbort(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['cherry-pick', '--abort'])
}

export async function resetTo(target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const { path: p, git: g } = getRepo()
    const headBefore = await g
        .revparse(['HEAD'])
        .then(out => out.trim())
        .catch(() => null)
    await g.raw(['reset', `--${mode}`, target])
    // Only fully recoverable modes are journaled: a hard reset's discarded workdir content is
    // gone for good (reflog restores just the pointer), so hard resets offer no Undo at all.
    if (mode !== 'hard' && headBefore) {
        pushUndo({
            label: `reset (${mode})`,
            doneMessage: 'Reset undone',
            repoPath: p,
            kind: 'reset',
            headBefore,
            resetMode: mode,
        })
    }
}
