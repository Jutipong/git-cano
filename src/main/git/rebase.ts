import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { baseEnv, getRepo, getRepoFor } from './repo'
import { interactiveRebases } from './state'
import { pushUndo } from './undo'
import { gitDirFor } from './util'

import type { CommitNode, RebaseEntry, RebaseOutcome, SquashPlan } from '@shared/types'

/** Rebase slice: the interactive-rebase engine (plan + start) and HEAD-range squash. */

/**
 * Interactive rebase runs the real `git rebase -i` so squash/fixup/reword/drop/edit follow git's own semantics (and conflicts pause in
 * place instead of aborting). We drive it by writing the todo ourselves: a tiny Node helper (run through `ELECTRON_RUN_AS_NODE`) acts as
 * both the sequence editor (writes our todo) and the commit-message editor (writes the per-commit message for reword/squash, read from the
 * command shown in COMMIT_EDITMSG's "Last command(s) done" block).
 */
const INTERACTIVE_REBASE_PLAN = 'git-cano-rebase-plan.json'

const REBASE_EDITOR_HELPER = String.raw`const fs = require('node:fs')
const path = require('node:path')
function readPlan() {
    try { return JSON.parse(fs.readFileSync(process.env.GITCANO_REBASE_PLAN, 'utf8')) } catch { return null }
}
const target = process.argv[2]
const data = readPlan()
if (target && data) {
    const name = path.basename(target)
    if (name === 'git-rebase-todo') {
        fs.writeFileSync(target, data.todo, 'utf8')
    } else if (name === 'COMMIT_EDITMSG' || name === 'message') {
        const lines = fs.readFileSync(target, 'utf8').split('\n')
        let inDone = false
        let current = ''
        for (const line of lines) {
            if (/^#\s+Last commands? done/.test(line)) { inDone = true; continue }
            if (inDone) {
                // Only reword/squash carry a message. A squash followed by fixup(s) opens the editor
                // once, and the block ends with the fixup — so keep the last reword/squash instead.
                const match = line.match(/^#\s+(?:reword|squash)\s+([0-9a-f]{7,})\b/)
                if (match) { current = match[1]; continue }
                if (/^#\s+Next command/.test(line)) inDone = false
            }
        }
        const messages = data.messages || {}
        const key = current && Object.keys(messages).find(hash => hash === current || hash.startsWith(current) || current.startsWith(hash.slice(0, 7)))
        if (key) fs.writeFileSync(target, messages[key] + '\n', 'utf8')
    }
}
process.exit(0)
`

export function rebaseInProgress(repoPath: string): boolean {
    const gitDir = gitDirFor(repoPath)
    return fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
}

export function rebasePlanPath(repoPath: string): string {
    return path.join(gitDirFor(repoPath), INTERACTIVE_REBASE_PLAN)
}

let rebaseEditorHelperFile: string | null = null
function rebaseEditorCommand(): string {
    if (!rebaseEditorHelperFile || !fs.existsSync(rebaseEditorHelperFile)) {
        rebaseEditorHelperFile = path.join(os.tmpdir(), 'git-cano-rebase-editor.cjs')
        fs.writeFileSync(rebaseEditorHelperFile, REBASE_EDITOR_HELPER, 'utf8')
    }
    // Forward slashes: git runs the editor through sh, where Windows backslashes would be escapes.
    const quote = (value: string) => `"${value.replace(/\\/g, '/')}"`
    return `${quote(process.execPath)} ${quote(rebaseEditorHelperFile)}`
}

export function rebaseEditorEnv(planFile: string): NodeJS.ProcessEnv {
    const editor = rebaseEditorCommand()
    return {
        ...baseEnv(),
        ELECTRON_RUN_AS_NODE: '1',
        GIT_SEQUENCE_EDITOR: editor,
        GIT_EDITOR: editor,
        GITCANO_REBASE_PLAN: planFile,
    }
}

export function cleanupRebase(repoPath: string): void {
    interactiveRebases.delete(repoPath)
    fs.promises.unlink(rebasePlanPath(repoPath)).catch(() => {})
}

export function finishRebase(repoPath: string, origHead: string): void {
    pushUndo({ label: 'rebase', doneMessage: 'Rebase undone', repoPath, kind: 'reset', headBefore: origHead, resetMode: 'hard' })
    cleanupRebase(repoPath)
}

export async function getRebasePlan(baseRef: string, dir?: string): Promise<CommitNode[]> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
    const text = await g.raw(['log', '--no-merges', '--reverse', `--pretty=format:${fmt}${REC}`, `${baseRef}..HEAD`, '--'])
    return text
        .split(REC)
        .map(line => line.replace(/^\n/, ''))
        .filter(line => line.trim())
        .map(line => {
            const [hash, shortHash, author, date, subject] = line.split(SEP)
            return { hash, shortHash, parents: [], author, date, subject, refs: [], lane: 0 }
        })
}

export async function getSquashPlan(targetHash: string): Promise<SquashPlan> {
    const { git: g } = getRepo()
    if (!targetHash.trim()) throw new Error('A commit is required')
    const target = (await g.raw(['rev-parse', '--verify', targetHash.trim()])).trim()
    const head = (await g.revparse(['HEAD'])).trim()
    if (target === head) throw new Error('Select an older commit — there is nothing to squash')
    let base: string
    try {
        base = (await g.raw(['rev-parse', `${target}^`])).trim()
    } catch {
        throw new Error('Cannot squash the root commit')
    }
    await g.raw(['merge-base', '--is-ancestor', target, 'HEAD']).catch(() => {
        throw new Error('Only commits on the current branch can be squashed')
    })
    const text = await g.raw(['log', '--reverse', '--pretty=format:%H%x1f%P%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e', `${base}..HEAD`, '--'])
    const commits: CommitNode[] = text
        .split('\x1e')
        .map(line => line.replace(/^\n/, ''))
        .filter(line => line.trim())
        .map(line => {
            const [hash, parentsRaw, shortHash, author, date, subject, bodyRaw] = line.split('\x1f')
            return {
                hash,
                shortHash,
                parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
                author,
                date,
                subject,
                body: bodyRaw?.trim() || undefined,
                refs: [],
                lane: 0,
            }
        })
    if (commits.length < 2) throw new Error('Select an older commit — there is nothing to squash')
    if (commits.some(c => c.parents.length > 1)) throw new Error('Merge commits cannot be squashed')
    const dirty = (await g.status()).files.length > 0
    const defaultMessage = commits[0]?.subject ?? ''
    return { base, target, commits, defaultMessage, dirty }
}

export async function squashCommits(baseHash: string, message: string): Promise<string> {
    const { path: p, git: g } = getRepo()
    const base = baseHash.trim()
    const trimmed = message.trim()
    if (!base) throw new Error('A base commit is required')
    if (!trimmed) throw new Error('Enter a commit message')
    await g.raw(['rev-parse', '--verify', base])
    if ((await g.status()).files.length > 0) throw new Error('Commit or stash your changes first')
    const headBefore = (await g.revparse(['HEAD'])).trim()
    await g.raw(['merge-base', '--is-ancestor', base, 'HEAD']).catch(() => {
        throw new Error('The base commit is no longer on this branch')
    })
    const count = Number.parseInt((await g.raw(['rev-list', '--count', `${base}..HEAD`])).trim(), 10)
    if (!Number.isFinite(count) || count < 2) throw new Error('There is nothing to squash')
    const parentsText = await g.raw(['log', '--pretty=format:%P', `${base}..HEAD`, '--'])
    if (parentsText.split('\n').some(line => line.trim().split(/\s+/).filter(Boolean).length > 1)) {
        throw new Error('Merge commits cannot be squashed')
    }
    await g.raw(['reset', '--soft', base])
    await g.commit(trimmed)
    pushUndo({ label: 'squash', doneMessage: 'Squash undone', repoPath: p, kind: 'commit', headBefore })
    return (await g.revparse(['HEAD'])).trim()
}

export async function startInteractiveRebase(baseRef: string, entries: RebaseEntry[], dir?: string): Promise<RebaseOutcome> {
    const { path: p, git: g } = dir ? getRepoFor(dir) : getRepo()
    const base = baseRef.trim()
    if (!base) throw new Error('A base branch is required')
    if (!entries.length) throw new Error('Nothing to rebase')
    // `git rebase` needs a clean tree and a free slot — refuse while another merge/rebase/cherry-pick is open.
    const gitDir = gitDirFor(p)
    if (rebaseInProgress(p) || fs.existsSync(path.join(gitDir, 'MERGE_HEAD')) || fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
        throw new Error('Finish or abort the current operation first')
    }
    if ((await g.status()).files.length > 0) throw new Error('Commit or stash your changes first')

    const origHead = (await g.revparse(['HEAD'])).trim()
    const planFile = rebasePlanPath(p)
    const todo = `${entries.map(entry => `${entry.command} ${entry.hash}`).join('\n')}\n`
    const messages: Record<string, string> = {}
    for (const entry of entries) {
        if ((entry.command === 'reword' || entry.command === 'squash') && entry.message?.trim()) messages[entry.hash] = entry.message.trim()
    }
    fs.writeFileSync(planFile, JSON.stringify({ todo, messages }), 'utf8')

    interactiveRebases.set(p, origHead)
    g.env(rebaseEditorEnv(planFile))
    try {
        await g.raw(['rebase', '-i', '--empty=keep', base])
    } catch (error) {
        // A conflict leaves the rebase state on disk — keep it so the user resolves it in the
        // Changes panel. Only a failure with no rebase state is a real error.
        if (!rebaseInProgress(p)) {
            cleanupRebase(p)
            throw error
        }
    } finally {
        g.env(baseEnv())
    }

    if (rebaseInProgress(p)) return { completed: false, message: 'Rebase paused — resolve any conflicts, then Continue' }
    finishRebase(p, origHead)
    const replayed = entries.filter(entry => entry.command !== 'drop').length
    return { completed: true, message: `Interactive rebase complete (${replayed} commits)` }
}
