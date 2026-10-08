import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { assignLanes } from '@shared/lanes'
import { resolveMarkdownImagePath } from '@shared/markdownImages'
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

import { authGitEnv } from './auth'
import { log, maskUrl } from './logger'
import { capContextSection, capDiffLines, escapeGitignorePath, parseDiff, parseLog } from './parsers'

import type {
    BlameLine,
    BranchInfo,
    CommitDetails,
    CommitFile,
    CommitNode,
    DiffMeta,
    DiffLine,
    FileEntry,
    GitignoreRuleKind,
    GitImage,
    LocalChangesMode,
    MergeCheck,
    MergeMode,
    RebaseEntry,
    RebaseOutcome,
    RebaseContinueResult,
    ReflogEntry,
    SquashPlan,
    RemoteTestResult,
    RepoState,
    RepoStatus,
    StashEntry,
    UndoPreview,
    AiContextScope,
    ConflictVersions,
    FileContent,
} from '@shared/types'
import type { FSWatcher } from 'node:fs'

const repoInstances = new Map<string, SimpleGit>()
let activeRepoPath: string | null = null
/**
 * Last computed log per repo path — lets the renderer paint instantly (stale-while-revalidate) when switching back.
 * Bounded to the most recently used repos so a long session with many tabs can't grow it forever.
 */
const logCache = new Map<string, { limit: number; commits: CommitNode[] }>()
const LOG_CACHE_MAX_REPOS = 6
/** Last computed branch list per repo path — same stale-while-revalidate purpose as logCache (branches change slowly). */
const branchCache = new Map<string, { local: BranchInfo[]; remote: BranchInfo[] }>()
const BRANCH_CACHE_MAX_REPOS = 6
/** Original HEAD per repo path while an interactive rebase is paused, so completion can be journaled for Undo. */
const interactiveRebases = new Map<string, string>()

/**
 * Simple-git (>=3.24) blocks env vars / config it considers unsafe unless the matching `unsafe.*` flag is enabled. This app intentionally
 * injects some of them itself, so the flags must mirror `authGitEnv()` and the desktop env:
 *
 * - GIT_SSH_COMMAND — pins the active SSH key → allowUnsafeSshCommand
 * - GIT_CONFIG_COUNT/KEY/VALUE — GitHub token extraheader → allowUnsafeConfigEnvCount + allowUnsafeConfigPaths
 * - GIT_EDITOR ('true') — non-interactive rebase steps → allowUnsafeEditor
 * - GIT_ASKPASS / SSH_ASKPASS — inherited from the desktop environment (e.g. VS Code) → allowUnsafeAskPass
 *
 * Simple-git v4 adds a second guard (`allowEnvironment`): every `git_*` env var is checked on spawn — vars merely inherited are stripped
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
    allowEnvironment: ['GIT_SSH_COMMAND', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR'],
} as unknown as Partial<SimpleGitOptions>

function createGit(dir: string): SimpleGit {
    const options = {
        debug: (data: string) => log('debug', 'git', maskUrl(data)),
        ...SAFE_UNSAFE_OPTIONS,
    } as unknown as Partial<SimpleGitOptions>
    const git = simpleGit(dir, options)
    git.env(baseEnv())
    return git
}

/**
 * Clean environment for local git operations — identical to the app's own env minus askpass variables inherited from the desktop
 * environment (e.g. VS Code), which simple-git blocks unless allowed. Auth credentials (SSH key / GitHub token) are NOT part of this; they
 * are injected per-command via `withAuthEnv`.
 *
 * simple-git v4's `allowEnvironment` guard throws when a git-sensitive env var is present in the env we inject — and `baseEnv()` injects the
 * whole process env. So strip the ambient names the app never wants git to honor (the user's editor/pager, stray config paths). The ones
 * `authGitEnv()` and the rebase helper inject themselves stay: they are listed in `allowEnvironment`.
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
    // the ones it does not know — so an unrelated variable like GITLAB_TOKEN or GIT_CANO_LOG_LEVEL makes every
    // spawn throw "blocked by the environment guard" and repos stop opening. Strip them all; the git envs we
    // intentionally inject (SSH command / config extraheader / editors) are added after baseEnv() and listed
    // in SAFE_UNSAFE_OPTIONS.allowEnvironment.
    for (const key of Object.keys(env)) {
        if (/^git/i.test(key)) delete env[key]
    }
    return env
}

/**
 * Runs a network operation (fetch/pull/push/ls-remote…) with the credentials configured in the Authentication settings injected for the
 * duration of that command only — repo opening and all local operations always run with the clean `baseEnv()`.
 */
async function withAuthEnv<T>(op: (git: SimpleGit) => Promise<T>): Promise<T> {
    const { git } = getRepo()
    git.env({ ...baseEnv(), ...authGitEnv() })
    try {
        return await op(git)
    } finally {
        git.env(baseEnv())
    }
}

/** Path-pinned variant of withAuthEnv — see getRepoFor for why pinned flows need it. */
async function withAuthEnvFor<T>(dir: string, op: (git: SimpleGit) => Promise<T>): Promise<T> {
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
 * worktrees. Never fails the open: each config write is swallowed on old/quirky git versions. The setting is hidden on macOS/Linux and
 * this gate keeps a persisted `true` from ever taking effect there.
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

/**
 * Opens a repo with a single git spawn (status doubles as the is-repo check; `checkIsRepo` only runs on the failure path to build the
 * proper error message). Safe to run for several dirs concurrently — status is computed per-instance, not through the global active repo.
 */
export async function openRepo(dir: string): Promise<RepoStatus> {
    const reopened = repoInstances.has(dir)
    const g = repoInstances.get(dir) ?? createGit(dir)
    const prevActive = activeRepoPath
    activeRepoPath = dir
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
        activeRepoPath = prevActive
        if (await g.checkIsRepo().catch(() => false)) throw error
        throw new Error(`"${dir}" is not a git repository`)
    }
}

export function setActiveRepo(dir: string): void {
    if (!repoInstances.has(dir)) throw new Error(`Repository "${dir}" is not open`)
    activeRepoPath = dir
    log('info', 'repo', `active -> ${dir}`)
}

export function closeRepo(dir?: string): void {
    const target = dir ?? activeRepoPath
    if (!target) return
    repoInstances.delete(target)
    // Drop its undo journal too — hashes from a previous life at the same path must not resurface.
    undoStacks.delete(target)
    interactiveRebases.delete(target)
    // Keep the log/branch cache for closed repos — it only costs a few hundred in-memory commits, is bounded
    // by the LRU caps above, and makes reopening (tab or workspace switch) paint instantly; selectTab always re-validates.
    unwatchRepo(target)
    if (activeRepoPath === target) {
        activeRepoPath = repoInstances.keys().next().value ?? null
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
    files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))

    const branch = status.current ?? 'HEAD (detached)'
    const ahead = status.ahead ?? 0
    const behind = status.behind ?? 0
    const tracking = status.tracking ?? null

    return { path: dir, name: path.basename(dir), branch, tracking, ahead, behind, files }
}

export async function getDiffMeta(file: string, staged: boolean): Promise<DiffMeta> {
    const { path: p, git: g } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const ext = path.extname(file).toLowerCase()
    const image = IMAGE_EXTS.includes(ext)
    if (!staged && (await isUntracked(g, file))) {
        return { binary: image ? false : isBinaryFile(p, file), image }
    }
    try {
        const numstat = await g.raw(['diff', ...(staged ? ['--cached'] : []), '--numstat', '--no-color', '--', file])
        const line = numstat.trim().split('\n')[0]
        if (!line) {
            // Empty numstat = no changes (ALL FILES mode can open unchanged files).
            // Probe the content getDiff() will display instead of mislabeling it binary.
            if (staged) {
                try {
                    const blob = await gitBinaryBuffer(p, ['cat-file', '-p', `:${file}`])
                    return { binary: blob.subarray(0, 8000).includes(0), image }
                } catch {
                    return { binary: false, image }
                }
            }
            return { binary: isBinaryFile(p, file), image }
        }
        const binary = !line || line.startsWith('-\t-\t') || line.startsWith('-	-	')
        return { binary, image }
    } catch {
        return { binary: !image, image }
    }
}

function gitBinaryBuffer(cwd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout as Buffer)
        })
    })
}

function parseNulPaths(buffer: Buffer): string[] {
    return buffer.toString('utf8').split('\0').filter(Boolean)
}

export async function listFiles(commitHash?: string): Promise<string[]> {
    const { path: p } = getRepo()
    const args = commitHash
        ? ['ls-tree', '-r', '-z', '--name-only', commitHash]
        : ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
    return parseNulPaths(await gitBinaryBuffer(p, args))
}

function normalizeGitignorePath(repoRoot: string, target: string): string {
    const trimmed = target.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) throw new Error('A file or directory path is required')
    const resolved = path.resolve(repoRoot, trimmed)
    const relative = path.relative(repoRoot, resolved)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('The path must be inside the repository')
    }
    return relative.split(path.sep).join('/')
}

async function addGitignoreRule(target: string, kind: GitignoreRuleKind, dir?: string): Promise<string> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    const repoRoot = (await g.revparse(['--show-toplevel'])).trim()
    let rule: string
    if (kind === 'extension') {
        const extension = target.trim().replace(/^\*/, '')
        if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(extension)) {
            throw new Error('Enter an extension such as .log')
        }
        rule = `*${extension}`
    } else if (kind === 'file') {
        rule = `/${escapeGitignorePath(normalizeGitignorePath(repoRoot, target))}`
    } else if (kind === 'directory') {
        rule = `/${escapeGitignorePath(normalizeGitignorePath(repoRoot, target))}/`
    } else {
        throw new Error('Invalid gitignore rule type')
    }

    const ignoreFile = path.join(repoRoot, '.gitignore')
    let existing = ''
    try {
        existing = await fs.promises.readFile(ignoreFile, 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const existingRules = existing.split(/\r?\n/).map(line => line.trim())
    if (existingRules.includes(rule)) return rule

    const eol = existing.includes('\r\n') ? '\r\n' : '\n'
    const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? '' : eol
    await fs.promises.writeFile(ignoreFile, `${existing}${prefix}${rule}${eol}`, 'utf8')
    return rule
}

export function addIgnoreRule(rule: string, dir?: string): Promise<string> {
    const trimmed = rule.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) throw new Error('A gitignore rule is required')
    if (trimmed.startsWith('*.')) return addGitignoreRule(trimmed, 'extension', dir)
    if (trimmed.endsWith('/')) return addGitignoreRule(trimmed.slice(0, -1), 'directory', dir)
    return addGitignoreRule(trimmed.replace(/^\//, ''), 'file', dir)
}

const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
}

export async function getImageVersion(file: string, source: 'workdir' | 'index' | 'head'): Promise<GitImage | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    try {
        let buf: Buffer
        if (source === 'workdir') {
            buf = await fs.promises.readFile(path.join(p, file))
        } else {
            const spec = source === 'index' ? `:${file}` : `HEAD:${file}`
            buf = await gitBinaryBuffer(p, ['cat-file', '-p', spec])
        }
        if (!buf.length) return null
        // Raw bytes instead of a base64 data URL — the renderer wraps these in a blob URL, so the
        // image never exists as an extra ~1.37x string on both sides of the IPC.
        return { mime, data: buf }
    } catch {
        return null
    }
}

function logArgs(limit: number, skip?: number): string[] {
    return [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        '--decorate=full',
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%<(1,trunc)%b'].join('\x1f')}\x1e`,
        '--date=iso',
        `--max-count=${limit}`,
        ...(skip ? [`--skip=${skip}`] : []),
        '--',
    ]
}

/** Moves a repo's log entry to the MRU end of the bounded cache, evicting the oldest entry when full. */
function cacheLog(repoPath: string, limit: number, commits: CommitNode[]): void {
    logCache.delete(repoPath)
    logCache.set(repoPath, { limit, commits })
    while (logCache.size > LOG_CACHE_MAX_REPOS) {
        const oldest = logCache.keys().next().value
        if (oldest === undefined) break
        logCache.delete(oldest)
    }
}

export async function getLog(limit = 500): Promise<CommitNode[]> {
    const { path: p, git: g } = getRepo()
    const commits = parseLog(await g.raw(logArgs(limit)))
    assignLanes(commits)
    cacheLog(p, limit, commits)
    return commits
}

/** Commit body only (`%b`) — lazy-loaded for the graph's message popover so the full log stays lean. Null when empty. */
export async function getCommitBody(hash: string, dir?: string): Promise<string | null> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    try {
        const body = (await g.raw(['show', '-s', '--format=%b', hash])).trim()
        return body || null
    } catch {
        return null
    }
}

/** Returns the cached log for the active repo when it covers `limit`, else null. May be stale — the renderer re-validates with repo:log. */
export function getCachedLog(limit = 500): CommitNode[] | null {
    if (!activeRepoPath) return null
    const entry = logCache.get(activeRepoPath)
    if (!entry || entry.limit < limit) return null
    // Reading counts as use — keep this repo at the MRU end of the bounded cache.
    logCache.delete(activeRepoPath)
    logCache.set(activeRepoPath, entry)
    return entry.commits.slice(0, limit)
}
export async function getLogPage(offset: number, limit: number): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    return parseLog(await g.raw(logArgs(limit, Math.max(0, offset))))
}

function soloLogArgs(branch: string, limit: number, skip?: number): string[] {
    return [
        'log',
        branch,
        '--decorate=full',
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%<(1,trunc)%b'].join('\x1f')}\x1e`,
        '--date=iso',
        `--max-count=${limit}`,
        ...(skip ? [`--skip=${skip}`] : []),
        '--',
    ]
}

function requireRevision(rev: string): string {
    const trimmed = rev.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) throw new Error('A branch is required')
    return trimmed
}

/** Commits reachable from a single branch — powers branch Solo in the graph. */
export async function getSoloLog(branch: string, limit = 500): Promise<CommitNode[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const commits = parseLog(await g.raw(soloLogArgs(rev, limit)))
    assignLanes(commits)
    return commits
}

export async function getSoloLogPage(branch: string, offset: number, limit: number): Promise<CommitNode[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const commits = parseLog(await g.raw(soloLogArgs(rev, limit, Math.max(0, offset))))
    assignLanes(commits)
    return commits
}

/**
 * Files touched by the commits visible in branch Solo (same depth as the solo log) — powers
 * Focus dimming in FilePanel. One spawn, paths only.
 */
export async function listSoloFiles(branch: string, limit = 500): Promise<string[]> {
    const rev = requireRevision(branch)
    const { git: g } = getRepo()
    await g.raw(['rev-parse', '--verify', rev])
    const text = await g.raw(['log', '--pretty=format:', '--name-only', `--max-count=${limit}`, rev, '--'])
    return [...new Set(text.split('\n').map(line => line.trim()).filter(Boolean))]
}

export async function stage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(paths)
}

export async function stageAll(dir?: string): Promise<void> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    await g.add('-A')
}

export async function unstage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...paths])
    await g.reset(['HEAD', '--', ...paths]).catch(() => {})
}

export async function unstageAll(): Promise<void> {
    const { git: g } = getRepo()
    try {
        await g.reset(['--'])
        return
    } catch {}
    await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '.'])
}

export async function discard(path_: string): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    const file = status.files.find(f => f.path === path_)
    if (!file) return
    if (file.working_dir === '?') {
        await g.raw(['clean', '-f', '--', path_])
    } else {
        await g.checkout(['--', path_])
    }
}

export async function discardUnstaged(): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    if (status.files.some(f => f.working_dir !== '?')) await g.checkout(['--', '.'])
}

export async function getDiff(file: string, staged: boolean, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    if (!staged && (await isUntracked(g, file))) {
        return capDiffLines(getUntrackedDiff(p, file))
    }
    const unified = `--unified=${context ?? 3}`
    const args = staged ? ['diff', '--cached', unified, '--no-color', '--', file] : ['diff', unified, '--no-color', '--', file]
    let text = ''
    try {
        text = await g.raw(args)
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text, file))
    // Empty diff = unchanged file (opened from ALL FILES mode) — show the full content
    // like Fork/GitKraken's file tree instead of an empty diff.
    return capDiffLines(await fullFileLines(p, file, staged))
}

async function isUntracked(g: SimpleGit, file: string): Promise<boolean> {
    try {
        const out = await g.raw(['status', '--porcelain', '--', file])
        return out.trimStart().startsWith('??')
    } catch {
        return false
    }
}

function isBinaryFile(repoPath: string, file: string): boolean {
    try {
        const buf = fs.readFileSync(path.join(repoPath, file))
        return buf.subarray(0, 8000).includes(0)
    } catch {
        return false
    }
}

function getUntrackedDiff(repoPath: string, file: string): DiffLine[] {
    let content = ''
    try {
        content = fs.readFileSync(path.join(repoPath, file), 'utf8')
    } catch {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    }
    const lineTexts = content.split('\n')
    if (lineTexts.length && lineTexts[lineTexts.length - 1] === '') lineTexts.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -0,0 +1,${lineTexts.length} @@` })
    lineTexts.forEach((text, i) => lines.push({ type: 'add', oldNo: null, newNo: i + 1, text: `+${text}` }))
    return lines
}

/**
 * Full-content fallback for unchanged files (ALL FILES mode): renders the blob as context lines so the viewer shows code like
 * Fork/GitKraken instead of an empty diff. `staged` selects the index blob, otherwise the working-tree file.
 */
async function fullFileLines(repoPath: string, file: string, staged: boolean): Promise<DiffLine[]> {
    let buf: Buffer | null = null
    if (staged) {
        try {
            buf = await gitBinaryBuffer(repoPath, ['cat-file', '-p', `:${file}`])
        } catch {
            buf = null
        }
    } else {
        try {
            buf = await fs.promises.readFile(path.join(repoPath, file))
        } catch {
            buf = null
        }
    }
    if (!buf) return []
    if (buf.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    return snapshotToCtxLines(file, buf.toString('utf8'))
}

/** Shared blob → context-lines rendering used by the commit/stash/workdir snapshot fallbacks. */
function snapshotToCtxLines(file: string, content: string): DiffLine[] {
    const snapshotLines = content.split('\n')
    if (snapshotLines[snapshotLines.length - 1] === '') snapshotLines.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `snapshot ${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -1,${snapshotLines.length} +1,${snapshotLines.length} @@` })
    snapshotLines.forEach((line, index) => {
        lines.push({ type: 'ctx', oldNo: index + 1, newNo: index + 1, text: ` ${line}` })
    })
    return lines
}

export async function getCommitDetails(hash: string): Promise<CommitDetails> {
    const { git: g } = getRepo()
    const [metadata, message] = await Promise.all([
        g.raw(['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P', hash]),
        g.raw(['show', '-s', '--format=%B', hash]),
    ])
    const [fullHash, author, email, date, parents = ''] = metadata.trim().split('\u001f')
    const parent = parents.split(' ').filter(Boolean)[0]
    // Deliberately no full `git diff` here: the Changes panel only needs the file list + message, and the
    // per-file diff is fetched lazily by DiffView through `file:commitDiff`. Diffing here doubled peak
    // memory (text + parsed lines on both sides of the IPC) for a payload the renderer discarded.
    const [fileText, numstatText] = await Promise.all([
        parent
            ? g.raw(['diff-tree', '--no-commit-id', '--name-status', '-r', parent, hash])
            : g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
        parent
            ? g.raw(['diff-tree', '--no-commit-id', '--numstat', '-r', parent, hash])
            : g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
    ])

    const statMap = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstatText.split('\n')) {
        if (!line.trim()) continue
        const [add, del, ...pathParts] = line.split('\t')
        statMap.set(pathParts.join('\t'), {
            additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
            deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
        })
    }

    const files = fileText
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [status, ...pathParts] = line.split('\t')
            const path = pathParts.join('\t')
            return { path, status, ...(statMap.get(path) ?? { additions: 0, deletions: 0 }) }
        })
    return {
        hash: fullHash || hash,
        message: message.trim(),
        author,
        email,
        date,
        parents: parents.split(' ').filter(Boolean),
        files,
    }
}

export async function listStashes(): Promise<StashEntry[]> {
    const { git: g } = getRepo()
    const raw = await g.raw(['stash', 'list', '--format=%gd%x00%H%x00%ci%x00%B'])
    return raw
        .split(/\n(?=stash@\{)/)
        .filter(Boolean)
        .map(line => {
            const [ref, hash, date, ...messageParts] = line.split('\x00')
            const match = /stash@\{(\d+)\}/.exec(ref)
            return { index: match ? Number(match[1]) : 0, hash, date, message: messageParts.join('\x00').trimEnd() }
        })
}

export async function createStash(message: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['stash', 'push', '--include-untracked', '-m', message || 'WIP'])
}

export async function applyStash(index: number, pop: boolean): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function dropStash(index: number): Promise<void> {
    const { path: p, git: g } = getRepo()
    // Capture the entry before dropping — `git stash store` can recreate it for Undo.
    const doomed = await listStashes()
        .then(entries => entries.find(entry => entry.index === index))
        .catch(() => undefined)
    await g.raw(['stash', 'drop', `stash@{${index}}`])
    if (doomed) {
        pushUndo({
            label: 'stash delete',
            doneMessage: 'Stash restored',
            repoPath: p,
            kind: 'dropStash',
            stashHash: doomed.hash,
            stashMessage: doomed.message,
        })
    }
}

function parseNumstatMap(text: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>()
    for (const line of text.split('\n')) {
        if (!line.trim()) continue
        const [add, del, ...pathParts] = line.split('\t')
        map.set(pathParts.join('\t'), {
            additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
            deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
        })
    }
    return map
}

function parseNameStatus(text: string, stats: Map<string, { additions: number; deletions: number }>): CommitFile[] {
    return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [status, ...pathParts] = line.split('\t')
            const path = pathParts.join('\t')
            return { path, status, ...(stats.get(path) ?? { additions: 0, deletions: 0 }) }
        })
}

// A stash is a merge commit: diff-tree/show against it directly don't work.
// Always diff against its first parent (the branch tip at stash time).
export async function getStashFiles(hash: string): Promise<CommitFile[]> {
    const { git: g } = getRepo()
    const [nameStatus, numstat, parents] = await Promise.all([
        g.raw(['diff', `${hash}^`, hash, '--no-color', '--name-status', '-r']),
        g.raw(['diff', `${hash}^`, hash, '--no-color', '--numstat', '-r']),
        g.raw(['show', '-s', '--format=%P', hash]),
    ])
    const files = parseNameStatus(nameStatus, parseNumstatMap(numstat))
    // 3rd parent of `stash push --include-untracked` holds the untracked files
    if (parents.trim().split(' ').filter(Boolean).length >= 3) {
        const [untrackedStatus, untrackedNumstat] = await Promise.all([
            g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', `${hash}^3`]),
            g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', `${hash}^3`]),
        ])
        files.push(...parseNameStatus(untrackedStatus, parseNumstatMap(untrackedNumstat)))
    }
    return files
}

function stashBlobAddedLines(file: string, snapshot: Buffer): DiffLine[] {
    const lineTexts = snapshot.toString('utf8').split('\n')
    if (lineTexts.length && lineTexts[lineTexts.length - 1] === '') lineTexts.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -0,0 +1,${lineTexts.length} @@` })
    lineTexts.forEach((text, i) => lines.push({ type: 'add', oldNo: null, newNo: i + 1, text: `+${text}` }))
    return lines
}

export async function getStashFileDiff(hash: string, file: string, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    let text = ''
    try {
        text = await g.raw(['diff', `${hash}^`, hash, `--unified=${context ?? 3}`, '--no-color', '--', file])
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text))

    // Empty diff: unchanged files (opened from ALL FILES mode) render the stash-tree blob
    // as context; untracked files kept in the 3rd parent keep their added-lines rendering.
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        if (snapshot.subarray(0, 8000).includes(0)) {
            return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
        }
        return capDiffLines(snapshotToCtxLines(file, snapshot.toString('utf8')))
    } catch {
        // not in the stash tree — fall through to the 3rd-parent check below
    }
    // empty tracked diff + untracked file kept in the stash's 3rd parent
    let snapshot: Buffer
    try {
        snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`])
    } catch {
        return []
    }
    if (snapshot.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    return capDiffLines(stashBlobAddedLines(file, snapshot))
}

export async function getStashFileMeta(hash: string, file: string): Promise<DiffMeta> {
    const { path: p } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const image = IMAGE_EXTS.includes(path.extname(file).toLowerCase())
    // tracked blob lives in the stash tree; untracked one in the 3rd parent
    const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`]))
        .catch(() => null)
    if (!snapshot) return { binary: false, image: false }
    return { binary: snapshot.subarray(0, 8000).includes(0), image }
}

export async function getStashImageVersion(hash: string, file: string): Promise<GitImage | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`]))
        .catch(() => null)
    if (!snapshot?.length) return null
    return { mime, data: snapshot }
}

/** Max bytes served per markdown image — keeps a huge screenshot from bloating the preview. */
const MARKDOWN_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/**
 * Repo-relative image referenced by a markdown preview (`![alt](src)`).
 * Relative sources resolve against the markdown file's directory (a leading
 * `/` anchors at the repo root); remote/inline/escaping sources resolve to
 * null so the renderer leaves them alone. Commit/stash previews read the blob
 * at that revision, otherwise the working tree is read.
 */
export async function getMarkdownImage(
    mdFile: string,
    src: string,
    commitHash?: string | null,
    stashHash?: string | null
): Promise<GitImage | null> {
    const target = resolveMarkdownImagePath(String(mdFile ?? ''), String(src ?? ''))
    if (!target) return null
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
    try {
        let buf: Buffer | null = null
        if (typeof stashHash === 'string' && stashHash) {
            buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${stashHash}:${target}`])
                .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${stashHash}^3:${target}`]))
                .catch(() => null)
        } else if (typeof commitHash === 'string' && commitHash) {
            buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${commitHash}:${target}`]).catch(() => null)
        } else {
            const abs = path.join(p, ...target.split('/'))
            const rel = path.relative(p, abs)
            if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
            buf = await fs.promises.readFile(abs).catch(() => null)
        }
        if (!buf?.length || buf.length > MARKDOWN_IMAGE_MAX_BYTES) return null
        return { mime, data: buf }
    } catch {
        return null
    }
}

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

/** Resolves the actual git dir — handles linked worktrees where `.git` is a pointer file. */
function resolveGitDir(dir: string): string {
    const dotGit = path.join(dir, '.git')
    try {
        if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
            const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))
            if (match) return path.resolve(dir, match[1].trim())
        }
    } catch {}
    return dotGit
}

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
    if (!activeRepoPath) return null
    return branchCache.get(activeRepoPath) ?? null
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
            g.raw(['merge-base', tip, rev]).then(out => out.trim(), () => ''),
            g.raw(['rev-parse', '--verify', tip]).then(out => out.trim(), () => ''),
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

function parseMergeTreeOutput(stdout: string): MergeCheck {
    // Success: a single tree OID line. Conflict (exit 1): tree OID, then with
    // --name-only one conflicted file per line until a blank line, then
    // informational messages ("CONFLICT (content): Merge conflict in …").
    const lines = stdout.split('\n').map(line => line.trim())
    const conflicts: string[] = []
    for (const line of lines.slice(1)) {
        if (!line) break
        conflicts.push(line)
    }
    if (!conflicts.length && lines.some(line => /^CONFLICT\b/.test(line))) {
        // No --name-only names parsed — fall back to the message lines.
        for (const line of lines) {
            const match = line.match(/^CONFLICT.*Merge conflict in (.+)$/)
            if (match) conflicts.push(match[1].trim())
        }
    }
    return { supported: true, fastForward: false, conflicts }
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
        const headBefore = await g.revparse(['HEAD']).then(out => out.trim()).catch(() => null)
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
    const oldTip = await g.raw(['rev-parse', '--verify', ref]).then(out => out.trim()).catch(() => null)
    const journalTip = async () => {
        if (!oldTip) return
        const newTip = await g.raw(['rev-parse', '--verify', ref]).then(out => out.trim()).catch(() => null)
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

export async function fetchAll(): Promise<string> {
    await withAuthEnv(git => git.fetch(['--all', '--tags', '--force']))
    return 'Fetch completed'
}

export async function push(force = false, dir?: string): Promise<string> {
    const { git: g } = dir ? getRepoFor(dir) : getRepo()
    const authedPush = (args: string[]) => (dir ? withAuthEnvFor(dir, git => git.push(args)) : withAuthEnv(git => git.push(args)))
    const status = await g.status()
    const branch = status.current
    const tracking = status.tracking
    if (tracking) await authedPush(force ? ['--force-with-lease'] : [])
    else await authedPush(['--set-upstream', 'origin', `refs/heads/${branch as string}`, ...(force ? ['--force-with-lease'] : [])])
    return force ? 'Force-pushed successfully' : 'Pushed successfully'
}

export async function pull(rebase = false): Promise<string> {
    const res = await withAuthEnv(git => git.pull([rebase ? '--rebase' : '--no-rebase']))
    return `Pulled (${res.summary.changes} changes)`
}

export async function pushBranch(name: string, force = false): Promise<string> {
    const { git: g } = getRepo()
    let upstream = ''
    try {
        upstream = (await g.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${name}@{upstream}`])).trim()
    } catch {}
    const flags = force ? ['--force-with-lease'] : []
    if (upstream) {
        const slash = upstream.indexOf('/')
        const remote = slash > 0 ? upstream.slice(0, slash) : 'origin'
        const remoteBranch = slash > 0 ? upstream.slice(slash + 1) : name
        await withAuthEnv(git => git.push([remote, `refs/heads/${name}:refs/heads/${remoteBranch}`, ...flags]))
        return force ? `${name} force-pushed` : `${name} pushed`
    }
    await withAuthEnv(git => git.push(['--set-upstream', 'origin', `refs/heads/${name}`, ...flags]))
    return force ? `${name} force-pushed` : `${name} pushed`
}

export async function pullBranch(name: string): Promise<string> {
    const { git: g } = getRepo()
    if ((await g.status()).current === name) {
        const res = await withAuthEnv(git => git.pull(['--no-rebase']))
        return `Pulled (${res.summary.changes} changes)`
    }
    let upstream = ''
    try {
        upstream = (await g.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${name}@{upstream}`])).trim()
    } catch {}
    if (!upstream) throw new Error(`"${name}" has no upstream; can't pull`)
    const slash = upstream.indexOf('/')
    if (slash <= 0) throw new Error(`Invalid upstream for "${name}": ${upstream}`)
    await withAuthEnv(git => git.fetch([upstream.slice(0, slash), upstream.slice(slash + 1)]))
    const oldTip = (await g.raw(['rev-parse', `refs/heads/${name}`])).trim()
    const fetched = (await g.raw(['rev-parse', 'FETCH_HEAD'])).trim()
    const base = (await g.raw(['merge-base', `refs/heads/${name}`, 'FETCH_HEAD'])).trim()
    if (fetched === oldTip) return `${name} already up to date`
    if (base === oldTip) {
        await g.raw(['update-ref', `refs/heads/${name}`, 'FETCH_HEAD', oldTip])
        return `Pulled ${name} (fast-forwarded)`
    }
    if (base === fetched) return `${name} already up to date`
    throw new Error(`"${name}" diverged from its upstream; refusing to fast-forward`)
}

export async function hasRemote(): Promise<boolean> {
    const { git: g } = getRepo()
    const remotes = await g.getRemotes()
    return remotes.length > 0
}

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

/**
 * HEAD reflog, newest first. This is the recovery net for history that the undo toast
 * window has already closed over (e.g. a hard reset) — the objects are still on disk.
 */
export async function listReflog(limit = 100): Promise<ReflogEntry[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const capped = Math.max(1, Math.min(500, Math.floor(limit) || 100))
    // `--date=iso-strict` makes %gd render HEAD@{<ISO 8601>}; the index is rebuilt from row order.
    // An unborn branch has no reflog at all — git exits non-zero with a raw fatal message, which
    // this recovery tool should surface as "nothing to recover", not as an error.
    const text = await g
        .raw(['reflog', '--date=iso-strict', `--format=%H${SEP}%h${SEP}%gd${SEP}%gs`, '-n', String(capped)])
        .catch(() => '')
    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const [hash, shortHash, selectorRaw, subject = ''] = line.split(SEP)
            const selector = (selectorRaw ?? '').trim()
            const date = /^HEAD@\{(.+)\}$/.exec(selector)?.[1]?.trim() ?? ''
            const colonAt = subject.indexOf(':')
            return {
                index,
                hash: hash ?? '',
                shortHash: shortHash ?? '',
                selector: `HEAD@{${index}}`,
                action: colonAt >= 0 ? subject.slice(0, colonAt).trim() : subject.trim(),
                message: colonAt >= 0 ? subject.slice(colonAt + 1).trim() : '',
                date,
            }
        })
}

/** Moves the current branch back to a reflog entry. Always journaled — the restore itself is undoable. */
export async function restoreReflog(ref: string): Promise<string> {
    const { path: p, git: g } = getRepo()
    const target = ref.trim()
    if (!target) throw new Error('A reflog entry is required')
    await g.raw(['rev-parse', '--verify', `${target}^{commit}`])
    if ((await g.status()).files.length > 0) throw new Error('Commit or stash your changes first')
    const headBefore = (await g.revparse(['HEAD'])).trim()
    await g.raw(['reset', '--hard', target])
    pushUndo({ label: 'reflog restore', doneMessage: 'Reflog restore undone', repoPath: p, kind: 'reset', headBefore, resetMode: 'hard' })
    return (await g.revparse(['HEAD'])).trim()
}

export async function getCommitFileDiff(hash: string, file: string, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    let text = ''
    try {
        const parents = (await g.raw(['show', '-s', '--format=%P', hash])).trim().split(/\s+/).filter(Boolean)
        text = parents.length
            ? await g.raw(['diff', parents[0], hash, `--unified=${context ?? 3}`, '--no-color', '--', file])
            : await g.raw(['show', `--unified=${context ?? 3}`, '--no-color', '--format=', hash, '--', file])
    } catch {}
    if (text.trim() || text.includes('Binary files')) return capDiffLines(parseDiff(text))

    let snapshot: Buffer
    try {
        snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
    } catch {
        return []
    }
    if (snapshot.subarray(0, 8000).includes(0)) {
        return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
    }
    const content = snapshot.toString('utf8')
    return capDiffLines(snapshotToCtxLines(file, content))
}

export async function getCommitFileMeta(hash: string, file: string): Promise<DiffMeta> {
    const { path: p } = getRepo()
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']
    const image = IMAGE_EXTS.includes(path.extname(file).toLowerCase())
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        return { binary: snapshot.subarray(0, 8000).includes(0), image }
    } catch {
        return { binary: false, image: false }
    }
}

export async function getCommitImageVersion(hash: string, file: string): Promise<GitImage | null> {
    const { path: p } = getRepo()
    const MIME_BY_EXT: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
    }
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        return snapshot.length ? { mime, data: snapshot } : null
    } catch {
        return null
    }
}

/** Max bytes read for read-only preview (markdown / JSON) — larger files report tooLarge. */
const PREVIEW_MAX_BYTES = 1024 * 1024

function toFileContent(buf: Buffer | null): FileContent {
    if (!buf) return { content: null, binary: false, tooLarge: false }
    if (buf.length > PREVIEW_MAX_BYTES) return { content: null, binary: false, tooLarge: true }
    if (buf.subarray(0, 8000).includes(0)) return { content: null, binary: true, tooLarge: false }
    return { content: buf.toString('utf8'), binary: false, tooLarge: false }
}

/** Working-tree (or index when staged) content for read-only preview. */
export async function getWorkdirFileContent(file: string, staged: boolean): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        const buf = staged
            ? await gitBinaryBuffer(p, ['cat-file', '-p', `:${file}`])
            : await fs.promises.readFile(path.join(p, file))
        return toFileContent(buf)
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
}

/** Blob content at a commit for read-only preview. */
export async function getCommitFileContent(hash: string, file: string): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        return toFileContent(await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`]))
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
}

/** Blob content in a stash (untracked files live in the 3rd parent) for read-only preview. */
export async function getStashFileContent(hash: string, file: string): Promise<FileContent> {
    const { path: p } = getRepo()
    try {
        const buf = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`]).catch(() =>
            gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`])
        )
        return toFileContent(buf)
    } catch {
        return { content: null, binary: false, tooLarge: false }
    }
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

/**
 * Undo journal for risky operations (commit/amend/reset/drop-stash). Each entry remembers the
 * pre-op state explicitly; the reflog is only the backstop — git never GCs the objects promptly,
 * so restoring a remembered ref is always safe. Keyed by repo path (never the mutable active
 * repo) so a tab switch mid-flight can't undo the wrong repository. The toast window is the UI
 * gate; the journal itself is just capped.
 */
type UndoKind = 'commit' | 'reset' | 'branchTip' | 'dropStash'

interface UndoEntry {
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

const undoStacks = new Map<string, UndoEntry[]>()
let nextUndoId = 0
const UNDO_STACK_LIMIT = 10

function pushUndo(entry: Omit<UndoEntry, 'id'>): void {
    const stack = undoStacks.get(entry.repoPath) ?? []
    stack.push({ ...entry, id: ++nextUndoId })
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
 * Undoes the latest journal entry, but only when `id` still matches the top — a stale toast
 * (another operation landed meanwhile) fails loudly instead of undoing the wrong action.
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

export interface TagRef {
    name: string
    hash: string
}

export async function listTags(): Promise<TagRef[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const text = await g.raw([
        'for-each-ref',
        'refs/tags',
        '--sort=refname', // tiebreak for equal dates
        '--sort=-creatordate', // primary: newest → oldest by creation date
        // `%(refname:short)` disambiguates against same-named branches (tag `backup` →
        // `tags/backup`), and that name then fails `git tag -d`. `lstrip=2` always strips
        // exactly `refs/tags/`, so the name round-trips through delete/push unchanged.
        `--format=%(refname:lstrip=2)${SEP}%(*objectname)${SEP}%(objectname)`,
    ])
    return text
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [name, peeled, object] = line.split(SEP)
            return { name, hash: peeled || object }
        })
}

export async function createTag(name: string, targetHash: string | null, message?: string): Promise<void> {
    const { git: g } = getRepo()
    if (!name.trim()) throw new Error('Tag name is required')
    const args = ['tag']
    if (message?.trim()) args.push('-a', name.trim(), '-m', message.trim())
    else args.push(name.trim())
    if (targetHash) args.push(targetHash)
    await g.raw(args)
}

export async function deleteTag(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['tag', '-d', name])
}

export async function pushTag(name: string): Promise<string> {
    await withAuthEnv(git => git.push(['origin', `refs/tags/${name.trim()}`]))
    return `Tag ${name.trim()} pushed`
}

export async function listRemoteTags(): Promise<string[]> {
    const { path: p } = getRepo()
    // Use a separate git instance so this network request cannot block local status/log operations.
    const remoteGit = plainGit(p)
    remoteGit.env({ ...baseEnv(), ...authGitEnv() })
    try {
        const out = await remoteGit.raw(['ls-remote', '--tags', 'origin'])
        const names = new Set<string>()
        for (const line of out.split('\n')) {
            const ref = line.split('\t')[1] ?? ''
            if (!ref.startsWith('refs/tags/')) continue
            names.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''))
        }
        return [...names]
    } catch {
        return []
    }
}

export async function deleteRemoteTag(name: string): Promise<string> {
    await withAuthEnv(git => git.push(['origin', `:refs/tags/${name.trim()}`]))
    return `Remote tag ${name.trim()} deleted`
}

export async function listRemotes(): Promise<{ name: string; url: string }[]> {
    const { path: p, git: g } = getRepo()
    const remotes = await g.getRemotes(true)
    void p
    return remotes.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }))
}

function sshHostFromUrl(url: string): string | null {
    const u = url.trim()
    if (!u) return null
    if (u.startsWith('ssh://')) {
        try {
            return new URL(u).hostname || null
        } catch {
            return null
        }
    }
    // scp-like syntax: git@host:path
    const m = u.match(/^(?:[^@\s]+@)?([A-Za-z0-9._-]+):/)
    if (m && !/^(https?|git|ssh|file)$/i.test(m[1])) return m[1]
    return null
}

/** SSH host for key tests, taken from the active repo's first SSH remote (e.g. `git@gitlab.com:…` → `gitlab.com`); defaults to GitHub. */
export async function sshTestHost(): Promise<string> {
    try {
        const { git: g } = getRepo()
        const remotes = await g.getRemotes(true)
        for (const r of remotes) {
            const host = sshHostFromUrl(r.refs.fetch || r.refs.push || '')
            if (host) return host
        }
    } catch {}
    return 'github.com'
}

export async function addRemote(name: string, url: string): Promise<void> {
    const { git: g } = getRepo()
    if (!name.trim() || !url.trim()) throw new Error('Name and URL are required')
    await g.raw(['remote', 'add', name.trim(), url.trim()])
}

export async function setRemoteUrl(name: string, url: string): Promise<void> {
    const { git: g } = getRepo()
    if (!url.trim()) throw new Error('URL is required')
    await g.raw(['remote', 'set-url', name, url.trim()])
}

export async function testRemoteUrl(rawUrl: string): Promise<RemoteTestResult> {
    const url = String(rawUrl ?? '').trim()
    if (!url) return { ok: false, message: 'Enter a remote URL first' }
    try {
        await new Promise<void>((resolve, reject) => {
            execFile('git', ['ls-remote', url, 'HEAD'], { timeout: 20_000, env: { ...baseEnv(), ...authGitEnv() } }, err => {
                if (err) reject(new Error(err instanceof Error ? err.message : String(err)))
                else resolve()
            })
        })
        log('info', 'git', `remote url test ok (${maskUrl(url)})`)
        return { ok: true, message: 'Remote URL is reachable' }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('warn', 'git', `remote url test failed (${maskUrl(url)}): ${message.slice(0, 200)}`)
        return { ok: false, message: message.slice(0, 300) }
    }
}

export async function getRawPatch(file: string, staged: boolean): Promise<string> {
    const { git: g } = getRepo()
    try {
        return await g.raw(['diff', ...(staged ? ['--cached'] : []), '--no-color', '--no-ext-diff', '--', file])
    } catch {
        return ''
    }
}

export async function getChangesContext(scope: AiContextScope = 'staged', dir?: string): Promise<string> {
    const { path: p, git: g } = dir ? getRepoFor(dir) : getRepo()
    const parts: string[] = []

    let stagedFiles: string[] = []
    let allLines: string[] = []
    try {
        const statusText = await g.raw(['status', '--porcelain'])
        allLines = statusText
            .split('\n')
            .map(line => line.trimEnd())
            .filter(Boolean)
        stagedFiles = allLines.filter(line => line[0] !== ' ' && line[0] !== '?')
    } catch {}

    if (scope === 'staged' && stagedFiles.length > 0) {
        parts.push(capContextSection(`Changed files (staged for commit):\n${stagedFiles.join('\n')}`))
        try {
            const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
            if (staged.trim()) parts.push(capContextSection(staged))
        } catch {}
        return parts.join('\n')
    }

    if (allLines.length) parts.push(capContextSection(`Changed files:\n${allLines.join('\n')}`))
    try {
        const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
        const unstaged = await g.raw(['diff', '--no-color', '--no-ext-diff'])
        if (staged.trim()) parts.push(capContextSection(staged))
        if (unstaged.trim()) parts.push(capContextSection(unstaged))
    } catch {}
    try {
        const untracked = await g.raw(['ls-files', '--others', '--exclude-standard'])
        const files = untracked
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .slice(0, 10)
        if (files.length) {
            const block = files
                .map(file => {
                    try {
                        const abs = path.join(p, file)
                        if (fs.statSync(abs).size > 256 * 1024) return `--- ${file} (new, large file — content omitted) ---`
                        const buf = fs.readFileSync(abs)
                        if (buf.subarray(0, 8000).includes(0)) return `--- ${file} (new, binary file — content omitted) ---`
                        return `--- ${file} (new) ---\n${buf.toString('utf8').slice(0, 2000)}`
                    } catch {
                        return `--- ${file} (new) ---`
                    }
                })
                .join('\n')
            parts.push(block)
        }
    } catch {}
    return parts.join('\n')
}

/** Runs the repository's formatter before AI commit-message generation. Does nothing when the repo has no `.oxfmtrc.json`. */
export function formatRepoIfConfigured(dir?: string): Promise<void> {
    const repoRoot = dir ? getRepoFor(dir).path : getRepo().path
    if (!fs.existsSync(path.join(repoRoot, '.oxfmtrc.json'))) return Promise.resolve()
    return runRepoFormat(repoRoot)
}

async function runRepoFormat(repoRoot: string): Promise<void> {
    const formatScript = readFormatScript(repoRoot)
    const [cmd, args] = formatScript ? [packageManager(repoRoot), ['run', 'format']] : npxOxfmtArgs(repoRoot)
    await runFormatCommand(cmd, args, repoRoot)
}

function readFormatScript(repoRoot: string): string | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
            scripts?: Record<string, string>
        }
        const script = pkg.scripts?.format?.trim()
        return script ? script : null
    } catch {
        return null
    }
}

function packageManager(repoRoot: string): string {
    for (const [lockfile, manager] of [
        ['pnpm-lock.yaml', 'pnpm'],
        ['bun.lockb', 'bun'],
        ['yarn.lock', 'yarn'],
        ['package-lock.json', 'npm'],
        ['npm-shrinkwrap.json', 'npm'],
    ]) {
        if (fs.existsSync(path.join(repoRoot, lockfile))) return manager
    }
    return 'npm'
}

function npxOxfmtArgs(repoRoot: string): [string, string[]] {
    const args = ['oxfmt', '--write']
    if (fs.existsSync(path.join(repoRoot, '.oxfmtignore'))) args.push('--ignore-path', '.oxfmtignore')
    return ['npx', args]
}

function runFormatCommand(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: 'ignore', shell: process.platform === 'win32' })
        child.on('error', err => reject(new Error(`Failed to launch formatter "${cmd} ${args.join(' ')}": ${err.message}`)))
        child.on('exit', code => {
            if (code === 0) resolve()
            else reject(new Error(`Formatter "${cmd} ${args.join(' ')}" exited with code ${code}`))
        })
    })
}

function writeTempPatch(patch: string): string {
    // The patch must live inside the repo's own git dir — `path.dirname(repo)` pointed at the parent
    // directory, so hunk staging failed with ENOENT for any repo whose parent has no `.git`.
    // resolveGitDir() also handles linked worktrees where `.git` is a pointer file.
    const tmp = path.join(resolveGitDir(getRepo().path), `git-cano-patch-${Date.now()}.patch`)
    fs.writeFileSync(tmp, patch.endsWith('\n') ? patch : `${patch}\n`)
    return tmp
}

export async function applyPatch(patch: string, target: 'index' | 'worktree', reverse: boolean): Promise<void> {
    const { git: g } = getRepo()
    if (!patch.trim()) throw new Error('Empty patch')
    const tmp = writeTempPatch(patch)
    const args = ['apply', '--whitespace=nowarn']
    if (target === 'index') args.push('--cached')
    if (reverse) args.push('--reverse')
    args.push(tmp)
    try {
        await g.raw(args)
    } catch (err) {
        throw new Error(
            String(err)
                .replace(/^Error:\s*(spawn|fatal:)?\s*/i, '')
                .slice(0, 300)
        )
    } finally {
        fs.promises.unlink(tmp).catch(() => {})
    }
}

export async function stageHunks(file: string, stagedView: boolean, hunkIndexes: number[], reverse: boolean): Promise<void> {
    const raw = await getRawPatch(file, stagedView)
    if (!raw.trim()) throw new Error('No changes found')

    const lines = raw.split('\n')
    const hunkStarts: number[] = []
    lines.forEach((line, i) => {
        if (line.startsWith('@@')) hunkStarts.push(i)
    })
    if (!hunkStarts.length) throw new Error('No hunks in this diff')

    const firstHunkLine = hunkStarts[0]
    const header = lines.slice(0, firstHunkLine)

    const hunkBlocks = hunkStarts.map((start, i) => {
        const end = i + 1 < hunkStarts.length ? hunkStarts[i + 1] : lines.length
        return lines.slice(start, end)
    })

    const chosen = hunkIndexes
        .filter(i => i >= 0 && i < hunkBlocks.length)
        .sort((a, b) => a - b)
        .map(i => hunkBlocks[i].join('\n'))
    if (!chosen.length) throw new Error('No hunks selected')

    const patch = [...header, ...chosen].join('\n')
    await applyPatch(patch, 'index', reverse)
}

export async function getFileHistory(file: string, limit = 200): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
    const text = await g.raw(['log', '--follow', `--pretty=format:${fmt}${REC}`, `--max-count=${limit}`, '--', file])
    return text
        .split(REC)
        .map(line => line.replace(/^\n/, ''))
        .filter(line => line.trim())
        .map(line => {
            const [hash, shortHash, author, date, subject] = line.split(SEP)
            return { hash, shortHash, parents: [], author, date, subject, refs: [], lane: 0 }
        })
}

export async function getBlame(file: string, rev?: string): Promise<BlameLine[]> {
    const { git: g } = getRepo()
    const at = rev?.trim()
    const text = await g.raw(at ? ['blame', '--line-porcelain', at, '--', file] : ['blame', '--line-porcelain', '--', file])
    const result: BlameLine[] = []
    const current: Partial<BlameLine> = {}
    for (const line of text.split('\n')) {
        if (line.startsWith('\t')) {
            result.push({
                hash: current.hash ?? '',
                author: current.author ?? '',
                date: current.date ?? '',
                lineNumber: current.lineNumber ?? 0,
                content: line.slice(1),
                ...(current.summary ? { summary: current.summary } : {}),
            })
            continue
        }
        const spaceAt = line.indexOf(' ')
        const key = spaceAt === -1 ? line : line.slice(0, spaceAt)
        const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1)
        if (/^[0-9a-f]{40}$/.test(key)) {
            // A new commit block starts — reset the per-commit fields (summary repeats only on first sighting).
            // The header carries `<orig> <final> [<count>]`: `final` is the line number in the blamed file.
            current.hash = key
            current.summary = undefined
            const finalNo = parseInt(value.split(' ')[1], 10)
            if (Number.isFinite(finalNo)) current.lineNumber = finalNo
        } else if (key === 'author') current.author = value
        else if (key === 'author-time') current.date = new Date(parseInt(value, 10) * 1000).toISOString()
        else if (key === 'summary' && current.summary === undefined) current.summary = value
        else if (/^\d+$/.test(key)) current.lineNumber = parseInt(key, 10)
    }
    return result
}

/**
 * Interactive rebase runs the real `git rebase -i` so squash/fixup/reword/drop/edit follow git's
 * own semantics (and conflicts pause in place instead of aborting). We drive it by writing the
 * todo ourselves: a tiny Node helper (run through `ELECTRON_RUN_AS_NODE`) acts as both the
 * sequence editor (writes our todo) and the commit-message editor (writes the per-commit message
 * for reword/squash, read from the command shown in COMMIT_EDITMSG's "Last command(s) done" block).
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

function gitDirFor(repoPath: string): string {
    return fs.existsSync(path.join(repoPath, '.git')) ? path.join(repoPath, '.git') : repoPath
}

function rebaseInProgress(repoPath: string): boolean {
    const gitDir = gitDirFor(repoPath)
    return fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
}

function rebasePlanPath(repoPath: string): string {
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

function rebaseEditorEnv(planFile: string): NodeJS.ProcessEnv {
    const editor = rebaseEditorCommand()
    return {
        ...baseEnv(),
        ELECTRON_RUN_AS_NODE: '1',
        GIT_SEQUENCE_EDITOR: editor,
        GIT_EDITOR: editor,
        GITCANO_REBASE_PLAN: planFile,
    }
}

function cleanupRebase(repoPath: string): void {
    interactiveRebases.delete(repoPath)
    fs.promises.unlink(rebasePlanPath(repoPath)).catch(() => {})
}

function finishRebase(repoPath: string, origHead: string): void {
    pushUndo({ label: 'rebase', doneMessage: 'Rebase undone', repoPath, kind: 'reset', headBefore: origHead, resetMode: 'hard' })
    cleanupRebase(repoPath)
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


