import * as fs from 'node:fs'
import * as path from 'node:path'

import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

import { authGitEnv } from '../auth'
import { log, maskUrl } from '../logger'
import { activeRepoPath, hasRemoteCache, interactiveRebases, repoInstances, setActiveRepoPath, undoStacks } from './state'

import type { FileEntry, RepoStatus } from '@shared/types'
import type { FSWatcher } from 'node:fs'

/**
 * Repo session slice: owns the live git instances, the active repo, the environment guard, repo open/close and the repo watcher.
 * Everything else resolves a repo through getRepo()/getRepoFor() instead of touching the registry.
 */

/**
 * `localeCompare` builds a collator per call; status sorts can hold tens of thousands of untracked paths, so share one instance. Default
 * locale/options keep the exact ordering `a.localeCompare(b)` produced.
 */
const pathCollator = new Intl.Collator()

/**
 * Simple-git (>=3.24) blocks env vars / config it considers unsafe unless the matching `unsafe.*` flag is enabled. This app intentionally
 * injects some of them itself, so the flags must mirror `authGitEnv()` and the desktop env:
 *
 * - GIT_SSH_COMMAND - pins the active SSH key → allowUnsafeSshCommand
 * - GIT_CONFIG_COUNT/KEY/VALUE - GitHub token extraheader → allowUnsafeConfigEnvCount + allowUnsafeConfigPaths
 * - GIT_EDITOR ('true') - non-interactive rebase steps → allowUnsafeEditor
 * - GIT_ASKPASS / SSH_ASKPASS - inherited from the desktop environment (e.g. VS Code) → allowUnsafeAskPass
 *
 * Simple-git v4 adds a second guard (`allowEnvironment`): every `git_*` env var is checked on spawn - vars merely inherited are stripped
 * silently, but any we inject ourselves throw unless listed here. So this mirrors the envs set above plus the ambient GIT_CONFIG_* the
 * desktop environment (e.g. VS Code) puts in `process.env`.
 */
const SAFE_UNSAFE_OPTIONS = {
    unsafe: {
        allowUnsafeAskPass: true,
        allowUnsafeSshCommand: true,
        allowUnsafeConfigEnvCount: true,
        allowUnsafeConfigPaths: true,
        allowUnsafeEditor: true,
    },
    allowEnvironment: [
        'GIT_SSH_COMMAND',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0',
        'GIT_CONFIG_VALUE_0',
        'GIT_EDITOR',
        'GIT_SEQUENCE_EDITOR',
    ],
} as unknown as Partial<SimpleGitOptions>

export function createGit(dir: string): SimpleGit {
    const options = {
        debug: (data: string) => log('debug', 'git', maskUrl(data)),
        ...SAFE_UNSAFE_OPTIONS,
    } as unknown as Partial<SimpleGitOptions>
    const git = simpleGit(dir, options)
    git.env(baseEnv())
    return git
}

/**
 * Clean environment for local git operations - identical to the app's own env minus askpass variables inherited from the desktop
 * environment (e.g. VS Code), which simple-git blocks unless allowed. Auth credentials (SSH key / GitHub token) are NOT part of this; they
 * are injected per-command via `withAuthEnv`.
 *
 * Simple-git v4's `allowEnvironment` guard throws when a git-sensitive env var is present in the env we inject - and `baseEnv()` injects
 * the whole process env. So strip the ambient names the app never wants git to honor (the user's editor/pager, stray config paths). The
 * ones `authGitEnv()` and the rebase helper inject themselves stay: they are listed in `allowEnvironment`.
 */
const GUARDED_AMBIENT_ENV_KEYS = [
    'EDITOR',
    'VISUAL',
    'PAGER',
    'GIT_PAGER',
    'GIT_CONFIG',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_PARAMETERS',
    'GIT_EXEC_PATH',
    'GIT_EXTERNAL_DIFF',
    'GIT_PROXY_COMMAND',
    'GIT_TEMPLATE_DIR',
    'GIT_SSH',
    // simple-git guards a bare `prefix` too (its full list is in @simple-git/argv-parser).
    'PREFIX',
]

export function baseEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.GIT_ASKPASS
    delete env.SSH_ASKPASS
    for (const key of GUARDED_AMBIENT_ENV_KEYS) delete env[key]
    // simple-git v4's environment guard collects *every* key starting with "git" (its parse-env step) and blocks
    // the ones it does not know - so an unrelated variable like GITLAB_TOKEN or GIT_CANO_LOG_LEVEL makes every
    // spawn throw "blocked by the environment guard" and repos stop opening. Strip them all; the git envs we
    // intentionally inject (SSH command / config extraheader / editors) are added after baseEnv() and listed
    // in SAFE_UNSAFE_OPTIONS.allowEnvironment.
    for (const key of Object.keys(env)) {
        if (/^git/i.test(key)) delete env[key]
    }
    return env
}

/**
 * Runs a network operation (fetch/pull/push/ls-remote.) with the credentials configured in the Authentication settings injected for the
 * duration of that command only - repo opening and all local operations always run with the clean `baseEnv()`.
 */
export async function withAuthEnv<T>(op: (git: SimpleGit) => Promise<T>): Promise<T> {
    const { git } = getRepo()
    git.env({ ...baseEnv(), ...authGitEnv() })
    try {
        return await op(git)
    } finally {
        git.env(baseEnv())
    }
}

/** Path-pinned variant of withAuthEnv — see getRepoFor for why pinned flows need it. */
export async function withAuthEnvFor<T>(dir: string, op: (git: SimpleGit) => Promise<T>): Promise<T> {
    const { git } = getRepoFor(dir)
    git.env({ ...baseEnv(), ...authGitEnv() })
    try {
        return await op(git)
    } finally {
        git.env(baseEnv())
    }
}

/** One-off git instance for standalone commands (init/clone) outside repo sessions. */
export function plainGit(dir = ''): SimpleGit {
    const git = simpleGit(dir, SAFE_UNSAFE_OPTIONS)
    git.env(baseEnv())
    return git
}

/**
 * Opt-in Windows-only status accelerators (Settings → General → Performance). When enabled, each opened repo gets `core.fsmonitor` +
 * `core.untrackedCache` written to its local config once per open — they make every subsequent `git status` dramatically faster on large
 * worktrees. Never fails the open: each config write is swallowed on old/quirky git versions. The setting is hidden on macOS/Linux and this
 * gate keeps a persisted `true` from ever taking effect there.
 */
let statusAcceleratorsEnabled = false

export function setStatusAccelerators(enabled: boolean): void {
    statusAcceleratorsEnabled = enabled && process.platform === 'win32'
}

export function getStatusAccelerators(): boolean {
    return statusAcceleratorsEnabled
}

async function ensureStatusAccelerators(dir: string): Promise<void> {
    if (!statusAcceleratorsEnabled) return
    const g = plainGit(dir)
    try {
        await g.addConfig('core.fsmonitor', 'true')
    } catch {}
    try {
        await g.addConfig('core.untrackedCache', 'true')
    } catch {}
}

export function getRepo(): { path: string; git: SimpleGit } {
    if (!activeRepoPath) throw new Error('No repository opened')
    const instance = repoInstances.get(activeRepoPath)
    if (!instance) throw new Error('Active repository is not registered')
    return { path: activeRepoPath, git: instance }
}

/**
 * Repo-scoped lookup that does NOT follow the global active repo. Long async flows (e.g. AI commit-message generation + auto-commit) must
 * pin the repo path at the start and resolve every step through here — otherwise a tab switch mid-flight would stage/commit/push the newly
 * activated repo instead of the intended one.
 */
export function getRepoFor(dir: string): { path: string; git: SimpleGit } {
    if (!dir || typeof dir !== 'string') throw new Error('A repository path is required')
    const instance = repoInstances.get(dir)
    if (!instance) throw new Error(`Repository "${dir}" is not open`)
    return { path: dir, git: instance }
}

/** A folder with no Git worktree anywhere up the tree — the renderer offers to initialize one there. */
export class NotARepoError extends Error {
    constructor(readonly dir: string) {
        super(`"${dir}" is not a git repository`)
        this.name = 'NotARepoError'
    }
}

/**
 * Opens a repo with a single git spawn (status doubles as the is-repo check; `checkIsRepo` only runs on the failure path to build the
 * proper error message). Safe to run for several dirs concurrently — status is computed per-instance, not through the global active repo.
 */
export async function openRepo(dir: string): Promise<RepoStatus> {
    const reopened = repoInstances.has(dir)
    const g = repoInstances.get(dir) ?? createGit(dir)
    const prevActive = activeRepoPath
    setActiveRepoPath(dir)
    if (!reopened) repoInstances.set(dir, g)
    try {
        const status = await getStatusFor(dir)
        watchRepo(dir)
        // fire-and-forget — config writes must never delay the open (see setStatusAccelerators)
        void ensureStatusAccelerators(dir)
        log('info', 'repo', `${reopened ? 'reopen' : 'open'} ${dir}`)
        return status
    } catch (error) {
        if (!reopened) {
            repoInstances.delete(dir)
            unwatchRepo(dir)
        }
        setActiveRepoPath(prevActive)
        if (await g.checkIsRepo().catch(() => false)) throw error
        throw new NotARepoError(dir)
    }
}

/**
 * Initializes a fresh repository in `dir` and opens it — the explicit "Initialize repository" step behind the open-folder flow, never an
 * automatic action. `git init` leaves the folder's files untouched; the branch is pinned to `main` regardless of `init.defaultBranch`.
 */
export async function initRepo(dir: string): Promise<RepoStatus> {
    const target = path.resolve(dir)
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error('Select an existing folder to initialize')
    if (path.parse(target).root === target) throw new Error('Cannot initialize a repository at a drive root')
    const g = plainGit(target)
    // Defense-in-depth: never create a nested repo inside an existing worktree.
    if (await g.checkIsRepo().catch(() => false)) throw new Error(`"${target}" is already inside a Git repository`)
    await g.raw(['init', '-b', 'main'])
    log('info', 'repo', `init ${target}`)
    return openRepo(target)
}

export function setActiveRepo(dir: string): void {
    if (!repoInstances.has(dir)) throw new Error(`Repository "${dir}" is not open`)
    setActiveRepoPath(dir)
    log('info', 'repo', `active -> ${dir}`)
}

export function closeRepo(dir?: string): void {
    const target = dir ?? activeRepoPath
    if (!target) return
    repoInstances.delete(target)
    // Drop its undo journal too — hashes from a previous life at the same path must not resurface.
    undoStacks.delete(target)
    interactiveRebases.delete(target)
    // Remote existence is re-read on the next open instead of trusting a cache from before the close.
    hasRemoteCache.delete(target)
    // Keep the log/branch cache for closed repos — it only costs a few hundred in-memory commits, is bounded
    // by the LRU caps in history.ts/branches.ts, and makes reopening (tab or workspace switch) paint instantly;
    // selectTab always re-validates.
    unwatchRepo(target)
    if (activeRepoPath === target) {
        setActiveRepoPath(repoInstances.keys().next().value ?? null)
        log('info', 'repo', `close ${target} — active falls back to ${activeRepoPath ?? 'none'}`)
    } else {
        log('info', 'repo', `close ${target}`)
    }
}

const repoWatchers = new Map<string, FSWatcher[]>()
let repoChangeCallback: ((repoPath: string) => void) | null = null
const emitTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function onRepoChanged(callback: (repoPath: string) => void): void {
    repoChangeCallback = callback
}

function watchRepo(dir: string): void {
    if (repoWatchers.has(dir)) return
    const gitDir = path.join(dir, '.git')
    if (!fs.existsSync(gitDir)) return
    const watchers: FSWatcher[] = []
    const emit = () => emitRepoChanged(dir)
    try {
        watchers.push(
            fs.watch(gitDir, (_event, filename) => {
                const name = typeof filename === 'string' ? filename : ''
                if (!name || name === 'index' || name.endsWith('.lock')) return
                // Remotes live in `.git/config` — drop the cached answer so the next refresh re-reads it.
                if (name === 'config') hasRemoteCache.delete(dir)
                emit()
            })
        )
        watchers.push(fs.watch(path.join(gitDir, 'refs'), { recursive: true } as never, emit))
    } catch {}
    repoWatchers.set(dir, watchers)
}

function unwatchRepo(dir: string): void {
    for (const watcher of repoWatchers.get(dir) ?? []) {
        watcher.close()
    }
    repoWatchers.delete(dir)
    const timer = emitTimers.get(dir)
    if (timer) clearTimeout(timer)
    emitTimers.delete(dir)
}

function emitRepoChanged(dir: string): void {
    const existing = emitTimers.get(dir)
    if (existing) clearTimeout(existing)
    emitTimers.set(
        dir,
        setTimeout(() => {
            emitTimers.delete(dir)
            repoChangeCallback?.(dir)
        }, 300)
    )
}

export function isOpen(): boolean {
    return activeRepoPath !== null
}

/** Path of the active repo, or null when none — lets callers clean up per-repo resources on close. */
export function getActiveRepoPath(): string | null {
    return activeRepoPath
}

export function getStatus(): Promise<RepoStatus> {
    const { path: p } = getRepo()
    return getStatusFor(p)
}

/** Status for a specific open repo — independent of the global active repo, so concurrent opens are safe. */
export async function getStatusFor(dir: string): Promise<RepoStatus> {
    const g = repoInstances.get(dir)
    if (!g) throw new Error(`Repository "${dir}" is not open`)
    const status = await g.status()
    const files: FileEntry[] = status.files.map(f => ({
        path: f.path,
        staged: f.index === '?' ? 'A' : f.index,
        unstaged: f.working_dir,
    }))
    const rank = (f: FileEntry) => (f.staged !== ' ' && f.staged !== '' ? 0 : f.unstaged === '?' ? 2 : 1)
    files.sort((a, b) => rank(a) - rank(b) || pathCollator.compare(a.path, b.path))

    const branch = status.current ?? 'HEAD (detached)'
    const ahead = status.ahead ?? 0
    const behind = status.behind ?? 0
    const tracking = status.tracking ?? null

    return { path: dir, name: path.basename(dir), branch, tracking, ahead, behind, files }
}
