import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { log } from '../logger'
import { parseMergeTreeOutput } from '../parsers'
import { createGit, getActiveRepoPath, getRepo, withAuthEnv } from './repo'
import { pushUndo } from './undo'
import { resolveGitDir } from './util'

import type { BranchInfo, LocalChangesMode, MergeCheck, MergeMode } from '@shared/types'
import type { SimpleGit } from 'simple-git'

/** Branch slice: list/create/checkout/delete, merge checks, worktree merges and local-change handling. */

/** Last computed branch list per repo path - same stale-while-revalidate purpose as logCache (branches change slowly). */
const branchCache = new Map<string, { local: BranchInfo[]; remote: BranchInfo[] }>()
const BRANCH_CACHE_MAX_REPOS = 6

/**
 * Lists local + remote branches with a single `for-each-ref` spawn — `%(HEAD)` marks the checked-out branch and `%(upstream:track)` carries
 * ahead/behind, so `branch -a` is not needed (one spawn saved per refresh; spawn cost dominates on Windows). Detached HEAD is detected by
 * reading the HEAD file directly instead of spawning `rev-parse`.
 */
export async function listBranches(): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> {
    const { path: p, git: g } = getRepo()
    // `%(refname)` (full) is used because `refname:short` collapses `refs/remotes/<r>/HEAD` to
    // just `<r>`, which the /HEAD filter below would miss — the prefix strip is deterministic.
    const refsText = await g.raw([
        'for-each-ref',
        '--format=%(refname)|%(upstream:track)|%(objectname)|%(HEAD)',
        'refs/heads',
        'refs/remotes',
    ])

    const local: BranchInfo[] = []
    const remote: BranchInfo[] = []
    for (const line of refsText.split('\n')) {
        if (!line.trim()) continue
        const [refname, t = '', commitHash = '', headFlag = ''] = line.split('|')
        if (!refname || refname.endsWith('/HEAD')) continue
        const isRemote = refname.startsWith('refs/remotes/')
        const name = isRemote ? refname.replace(/^refs\/remotes\//, '') : refname.replace(/^refs\/heads\//, '')
        if (!name || name.includes('->')) continue
        const ahead = /\bahead (\d+)/.exec(t)?.[1]
        const behind = /\bbehind (\d+)/.exec(t)?.[1]
        const info: BranchInfo = { name, current: headFlag === '*' }
        if (ahead) info.ahead = Number(ahead)
        if (behind) info.behind = Number(behind)
        if (commitHash) info.commitHash = commitHash
        if (isRemote) remote.push(info)
        else local.push(info)
    }

    let head = ''
    try {
        head = fs.readFileSync(path.join(resolveGitDir(p), 'HEAD'), 'utf8').trim()
    } catch {}
    if (head && !head.startsWith('ref:') && !local.some(b => b.current)) {
        local.unshift({ name: head.slice(0, 7), current: true, detached: true, commitHash: head })
    }

    const result = { local, remote }
    // Bounded, MRU-ordered cache — see logCache.
    branchCache.delete(p)
    branchCache.set(p, result)
    while (branchCache.size > BRANCH_CACHE_MAX_REPOS) {
        const oldest = branchCache.keys().next().value
        if (oldest === undefined) break
        branchCache.delete(oldest)
    }
    return result
}

/** Cached branch list for the active repo, or null. May be stale — the renderer re-validates with branch:list. */
export function getCachedBranches(): { local: BranchInfo[]; remote: BranchInfo[] } | null {
    const active = getActiveRepoPath()
    if (!active) return null
    return branchCache.get(active) ?? null
}

export async function createBranch(name: string, checkout: boolean, startPoint?: string): Promise<void> {
    const { git: g } = getRepo()
    const start = startPoint || 'HEAD'
    if (checkout) await g.checkoutBranch(name, start)
    else await g.raw(['branch', name, start])
}

export async function discardAllChanges(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['reset', '--hard'])
    await g.clean(['f', 'd'])
}

export async function createBranchWithOptions(
    name: string,
    checkout: boolean,
    localChanges: LocalChangesMode,
    startPoint?: string
): Promise<void> {
    const { git: g } = getRepo()
    if (!checkout || localChanges === 'keep') {
        await createBranch(name, checkout, startPoint)
        return
    }
    if (localChanges === 'discard') {
        await discardAllChanges()
        await createBranch(name, true, startPoint)
        return
    }
    // stash and reapply
    const status = await g.status()
    const dirty = status.files.length > 0
    let stashed = false
    if (dirty) {
        await g.raw(['stash', 'push', '--include-untracked', '-m', `create-branch: ${name}`])
        stashed = true
    }
    try {
        await createBranch(name, true, startPoint)
    } catch (error) {
        if (stashed) await g.raw(['stash', 'pop']).catch(() => {})
        throw error
    }
    if (stashed) {
        // On conflict git keeps the stash entry — leave it for the user to resolve.
        await g.raw(['stash', 'pop']).catch(() => {})
    }
}

export async function checkout(ref: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(ref)
}

export async function checkoutWithOptions(ref: string, localChanges: LocalChangesMode): Promise<void> {
    const { git: g } = getRepo()
    if (localChanges === 'keep') {
        await checkout(ref)
        return
    }
    if (localChanges === 'discard') {
        await discardAllChanges()
        await checkout(ref)
        return
    }
    // stash and reapply
    const status = await g.status()
    const dirty = status.files.length > 0
    let stashed = false
    if (dirty) {
        await g.raw(['stash', 'push', '--include-untracked', '-m', `switch-branch: ${ref}`])
        stashed = true
    }
    try {
        await checkout(ref)
    } catch (error) {
        if (stashed) await g.raw(['stash', 'pop']).catch(() => {})
        throw error
    }
    if (stashed) {
        // On conflict git keeps the stash entry — leave it for the user to resolve.
        await g.raw(['stash', 'pop']).catch(() => {})
    }
}

export async function checkoutRemoteWithOptions(ref: string, localChanges: LocalChangesMode): Promise<void> {
    const { git: g } = getRepo()
    const parts = ref.replace(/^remotes\//, '').split('/')
    const remote = parts.shift()
    const branch = parts.join('/')
    if (!remote || !branch) throw new Error(`Invalid remote branch reference: ${ref}`)
    const target = `${remote}/${branch}`
    const localExists = await g.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
        () => true,
        () => false
    )
    const doCheckout = async () => {
        if (localExists) {
            await g.checkout(branch)
            const upstream = await g.raw(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]).then(
                out => out.trim(),
                () => null
            )
            if (upstream !== target) {
                await g.raw(['branch', '--set-upstream-to', target, branch])
            }
        } else {
            await g.raw(['checkout', '-b', branch, '--track', target])
        }
    }
    if (localChanges === 'keep') {
        await doCheckout()
        return
    }
    if (localChanges === 'discard') {
        await discardAllChanges()
        await doCheckout()
        return
    }
    // stash and reapply
    const status = await g.status()
    const dirty = status.files.length > 0
    let stashed = false
    if (dirty) {
        await g.raw(['stash', 'push', '--include-untracked', '-m', `switch-branch: ${branch}`])
        stashed = true
    }
    try {
        await doCheckout()
    } catch (error) {
        if (stashed) await g.raw(['stash', 'pop']).catch(() => {})
        throw error
    }
    if (stashed) {
        // On conflict git keeps the stash entry — leave it for the user to resolve.
        await g.raw(['stash', 'pop']).catch(() => {})
    }
}

export async function deleteBranch(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.deleteLocalBranch(name, true)
}

export async function deleteRemoteBranch(ref: string): Promise<string> {
    const parts = ref.replace(/^remotes\//, '').split('/')
    const remote = parts.shift()
    const branch = parts.join('/')
    if (!remote || !branch) throw new Error(`Invalid remote branch reference: ${ref}`)
    await withAuthEnv(g => g.push([remote, `:refs/heads/${branch}`]))
    return `Remote branch ${branch} deleted`
}

export async function merge(name: string): Promise<string> {
    const { git: g } = getRepo()
    const res = await g.merge([name, '--no-edit'])
    return res.result || 'Merged'
}

/** True when merging `source` into `target` can fast-forward. */
async function isFastForward(g: SimpleGit, source: string, target: string): Promise<boolean> {
    const targetHead = (await g.raw(['rev-parse', '--verify', target])).trim()
    const base = (await g.raw(['merge-base', target, source])).trim()
    return base === targetHead
}

/**
 * Dry-run merge check via `git merge-tree --write-tree` — computes the merge result without touching any worktree. Requires git >= 2.38,
 * otherwise `supported: false`.
 *
 * Note: simple-git's `raw()` only rejects on stderr; `merge-tree` reports conflicts on stdout with exit code 1, so conflicts must be
 * detected by parsing the successful output, not via try/catch.
 */
export async function checkMergeConflicts(source: string, target: string): Promise<MergeCheck> {
    const { git: g } = getRepo()
    if (await isFastForward(g, source, target)) {
        return { supported: true, fastForward: true, conflicts: [] }
    }
    let stdout = ''
    try {
        stdout = await g.raw(['merge-tree', '--write-tree', '--name-only', target, source])
    } catch (error) {
        const err = error as { git?: { stdout?: string }; message?: string }
        stdout = err.git?.stdout ?? ''
        if (!stdout) {
            const text = err.message ?? ''
            if (!/unknown option|unrecognized|usage: git merge-tree/i.test(text)) {
                log('warn', 'git', `merge-tree check failed: ${text.split('\n')[0]}`)
            }
            return { supported: false, fastForward: false, conflicts: [] }
        }
    }
    return parseMergeTreeOutput(stdout)
}

/**
 * Merge `source` into `target` without switching the user's current branch: fast-forwards the ref directly when possible, otherwise
 * performs the merge inside a temporary worktree. Only when that merge conflicts does it fall back to checking out `target` in the main
 * repo so the conflict banner can drive resolution.
 */
export async function mergeInto(source: string, target: string, mode: MergeMode = 'default'): Promise<string> {
    const { path: p, git: g } = getRepo()
    const status = await g.status()
    if (status.files.length > 0) throw new Error('Commit or stash your changes before merging')
    if (status.current === target) {
        const headBefore = await g
            .revparse(['HEAD'])
            .then(out => out.trim())
            .catch(() => null)
        const args: string[] = [source]
        if (mode === 'no-ff') args.push('--no-ff')
        else if (mode === 'ff-only') args.push('--ff-only')
        args.push('--no-edit')
        const res = await g.merge(args)
        // Conflicts throw above, so reaching here means the merge committed cleanly.
        if (headBefore) {
            pushUndo({ label: 'merge', doneMessage: 'Merge undone', repoPath: p, kind: 'reset', headBefore, resetMode: 'hard' })
        }
        return res.result || 'Merged'
    }

    const ref = `refs/heads/${target}`
    const oldTip = await g
        .raw(['rev-parse', '--verify', ref])
        .then(out => out.trim())
        .catch(() => null)
    const journalTip = async () => {
        if (!oldTip) return
        const newTip = await g
            .raw(['rev-parse', '--verify', ref])
            .then(out => out.trim())
            .catch(() => null)
        if (newTip && newTip !== oldTip) {
            pushUndo({ label: 'merge', doneMessage: 'Merge undone', repoPath: p, kind: 'branchTip', ref, oldTip, newTip })
        }
    }

    const ff = await isFastForward(g, source, target)
    if (mode === 'ff-only') {
        if (!ff) throw new Error(`"${target}" cannot be fast-forwarded to "${source}"`)
        // Updates the branch ref without any checkout (refuses non-ff).
        await g.raw(['fetch', '.', `refs/heads/${source}:refs/heads/${target}`])
        await journalTip()
        return `Fast-forwarded ${target} to ${source}`
    }
    if (mode === 'default' && ff) {
        await g.raw(['fetch', '.', `refs/heads/${source}:refs/heads/${target}`])
        await journalTip()
        return `Fast-forwarded ${target} to ${source}`
    }

    const tmp = path.join(os.tmpdir(), `git-cano-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    let worktreeFailed: unknown = null
    try {
        await g.raw(['worktree', 'add', tmp, target])
        await createGit(tmp).merge(mode === 'no-ff' ? [source, '--no-ff', '--no-edit'] : [source, '--no-edit'])
        await journalTip()
        return 'Merged'
    } catch (error) {
        worktreeFailed = error
        await createGit(tmp)
            .raw(['merge', '--abort'])
            .catch(() => {})
    } finally {
        await g.raw(['worktree', 'remove', '--force', tmp]).catch(() => {
            try {
                fs.rmSync(tmp, { recursive: true, force: true })
            } catch {}
        })
    }
    if (worktreeFailed) {
        // Conflicted (or unsupported) merge — resolve in the main repo so the
        // conflict banner sees the state.
        await g.checkout(target)
        return merge(source)
    }
    return 'Merged'
}
