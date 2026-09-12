import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { assignLanes } from '@shared/lanes'
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

import { authGitEnv } from './auth'
import { log, maskUrl } from './logger'

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
    LocalChangesMode,
    MergeCheck,
    MergeMode,
    RebaseEntry,
    RebaseOutcome,
    ReflogEntry,
    SquashPlan,
    RemoteTestResult,
    RepoState,
    RepoStatus,
    StashEntry,
    UndoPreview,
    WorktreeInfo,
    AiContextScope,
    ConflictVersions,
} from '@shared/types'
import type { FSWatcher } from 'node:fs'

const repoInstances = new Map<string, SimpleGit>()
let activeRepoPath: string | null = null
/** Last computed log per repo path — lets the renderer paint instantly (stale-while-revalidate) when switching back. */
const logCache = new Map<string, { limit: number; commits: CommitNode[] }>()
/** Last computed branch list per repo path — same stale-while-revalidate purpose as logCache (branches change slowly). */
const branchCache = new Map<string, { local: BranchInfo[]; remote: BranchInfo[] }>()

/**
 * Simple-git (>=3.24) blocks env vars / config it considers unsafe unless the matching `unsafe.*` flag is enabled. This app intentionally
 * injects some of them itself, so the flags must mirror `authGitEnv()` and the desktop env:
 *
 * - GIT_SSH_COMMAND — pins the active SSH key → allowUnsafeSshCommand
 * - GIT_CONFIG_COUNT/KEY/VALUE — GitHub token extraheader → allowUnsafeConfigEnvCount + allowUnsafeConfigPaths
 * - GIT_EDITOR ('true') — non-interactive rebase steps → allowUnsafeEditor
 * - GIT_ASKPASS / SSH_ASKPASS — inherited from the desktop environment (e.g. VS Code) → allowUnsafeAskPass
 */
const SAFE_UNSAFE_OPTIONS = {
    unsafe: {
        allowUnsafeAskPass: true,
        allowUnsafeSshCommand: true,
        allowUnsafeConfigEnvCount: true,
        allowUnsafeConfigPaths: true,
        allowUnsafeEditor: true,
    },
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
 */
export function baseEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.GIT_ASKPASS
    delete env.SSH_ASKPASS
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
 * Opt-in Windows status accelerators (Settings → General → Performance). When enabled, each opened repo gets `core.fsmonitor` +
 * `core.untrackedCache` written to its local config once per open — they make every subsequent `git status` dramatically faster on large
 * worktrees. Never fails the open: each config write is swallowed on old/quirky git versions.
 */
let statusAcceleratorsEnabled = false

export function setStatusAccelerators(enabled: boolean): void {
    statusAcceleratorsEnabled = enabled
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

export function listOpenRepos(): string[] {
    return [...repoInstances.keys()]
}

export function closeRepo(dir?: string): void {
    const target = dir ?? activeRepoPath
    if (!target) return
    repoInstances.delete(target)
    // Drop its undo journal too — hashes from a previous life at the same path must not resurface.
    undoStacks.delete(target)
    // Keep the log cache for closed repos — it only costs a few hundred in-memory commits and
    // makes reopening (tab or workspace switch) paint instantly; selectTab always re-validates.
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

async function addGitignoreRule(target: string, kind: GitignoreRuleKind): Promise<string> {
    const { git: g } = getRepo()
    const repoRoot = (await g.revparse(['--show-toplevel'])).trim()
    let rule: string
    if (kind === 'extension') {
        const extension = target.trim().replace(/^\*/, '')
        if (!/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(extension)) {
            throw new Error('Enter an extension such as .log')
        }
        rule = `*${extension}`
    } else if (kind === 'file') {
        rule = `/${normalizeGitignorePath(repoRoot, target)}`
    } else if (kind === 'directory') {
        rule = `/${normalizeGitignorePath(repoRoot, target)}/`
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

export function addIgnoreRule(rule: string): Promise<string> {
    const trimmed = rule.trim()
    if (!trimmed || /[\0\r\n]/.test(trimmed)) throw new Error('A gitignore rule is required')
    if (trimmed.startsWith('*.')) return addGitignoreRule(trimmed, 'extension')
    if (trimmed.endsWith('/')) return addGitignoreRule(trimmed.slice(0, -1), 'directory')
    return addGitignoreRule(trimmed.replace(/^\//, ''), 'file')
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

export async function getImageVersion(file: string, source: 'workdir' | 'index' | 'head'): Promise<string | null> {
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
        return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
        return null
    }
}

function normalizeRef(raw: string): string | null {
    const s = raw.trim()
    if (!s) return null
    if (s.startsWith('HEAD -> ')) {
        const target = s.slice('HEAD -> '.length).trim()
        return `HEAD -> ${target.replace(/^refs\/heads\//, '')}`
    }
    if (s.startsWith('tag:')) {
        const name = s
            .slice(4)
            .trim()
            .replace(/\^\{\}$/, '')
            .replace(/^refs\/tags\//, '')
        return `tag: ${name}`
    }
    if (s.startsWith('refs/tags/')) return `tag: ${s.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')}`
    if (s.startsWith('refs/remotes/')) {
        const short = s.replace(/^refs\/remotes\//, '')
        if (!short || short.endsWith('/HEAD')) return null
        return `remote:${short}`
    }
    if (s.startsWith('refs/heads/')) return s.replace(/^refs\/heads\//, '')
    if (s.endsWith('/HEAD')) return null
    return s
}

function parseLog(text: string): CommitNode[] {
    const SEP = '\x1f'
    const REC = '\x1e'
    const commits: CommitNode[] = []
    for (const line of text.split(REC)) {
        const t = line.replace(/^\n/, '')
        if (!t.trim()) continue
        const [hash, parents, shortHash, author, authorEmail, date, refsRaw, subject, bodyRaw] = t.split(SEP)
        const refs = refsRaw
            ? refsRaw
                  .trim()
                  .replace(/^\(/, '')
                  .replace(/\)$/, '')
                  .split(',')
                  .map(normalizeRef)
                  .filter((ref): ref is string => !!ref)
            : []
        commits.push({
            hash,
            shortHash,
            parents: parents ? parents.split(' ').filter(Boolean) : [],
            author,
            authorEmail: authorEmail || undefined,
            date,
            subject,
            body: bodyRaw ? bodyRaw.trim() || undefined : undefined,
            refs,
            lane: 0,
        })
    }
    return commits
}

function logArgs(limit: number, skip?: number): string[] {
    return [
        'log',
        '--branches',
        '--remotes',
        '--tags',
        '--decorate=full',
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%b'].join('\x1f')}\x1e`,
        '--date=iso',
        `--max-count=${limit}`,
        ...(skip ? [`--skip=${skip}`] : []),
        '--',
    ]
}

export async function getLog(limit = 500): Promise<CommitNode[]> {
    const { path: p, git: g } = getRepo()
    const commits = parseLog(await g.raw(logArgs(limit)))
    assignLanes(commits)
    logCache.set(p, { limit, commits })
    return commits
}

/** Returns the cached log for the active repo when it covers `limit`, else null. May be stale — the renderer re-validates with repo:log. */
export function getCachedLog(limit = 500): CommitNode[] | null {
    if (!activeRepoPath) return null
    const entry = logCache.get(activeRepoPath)
    if (!entry || entry.limit < limit) return null
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
        `--pretty=format:${['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%b'].join('\x1f')}\x1e`,
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

export async function discardUntracked(): Promise<void> {
    const { git: g } = getRepo()
    const status = await g.status()
    if (status.files.some(f => f.working_dir === '?')) await g.clean(['f', 'd'])
}

export async function commit(message: string): Promise<string> {
    const { git: g } = getRepo()
    const res = await g.commit(message)
    return res.commit
}

export async function getDiff(file: string, staged: boolean, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    if (!staged && (await isUntracked(g, file))) {
        return getUntrackedDiff(p, file)
    }
    const unified = `--unified=${context ?? 3}`
    const args = staged ? ['diff', '--cached', unified, '--no-color', '--', file] : ['diff', unified, '--no-color', '--', file]
    let text = ''
    try {
        text = await g.raw(args)
    } catch {}
    if (text.trim() || text.includes('Binary files')) return parseDiff(text, file)
    // Empty diff = unchanged file (opened from ALL FILES mode) — show the full content
    // like Fork/GitKraken's file tree instead of an empty diff.
    return fullFileLines(p, file, staged)
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

function parseDiff(text: string, file?: string): DiffLine[] {
    const lines: DiffLine[] = file ? [{ type: 'meta', oldNo: null, newNo: null, text: `diff --git a/${file} b/${file}` }] : []
    let oldNo = 0
    let newNo = 0

    for (const line of text.split('\n')) {
        if (
            line.startsWith('diff ') ||
            line.startsWith('index ') ||
            line.startsWith('--- ') ||
            line.startsWith('+++ ') ||
            line.startsWith('similarity ') ||
            line.startsWith('rename ')
        ) {
            continue
        }
        if (line.startsWith('@@')) {
            const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
            oldNo = m ? parseInt(m[1], 10) : 0
            newNo = m ? parseInt(m[2], 10) : 0
            lines.push({ type: 'hunk', oldNo: null, newNo: null, text: line })
        } else if (line.startsWith('+')) {
            lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: line })
        } else if (line.startsWith('-')) {
            lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line })
        } else if (line.startsWith(' ')) {
            lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line })
        } else if (line.startsWith('\\')) {
            lines.push({ type: 'meta', oldNo: null, newNo: null, text: line })
        }
    }
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
    const [diffText, fileText, numstatText] = await Promise.all([
        parent ? g.raw(['diff', '--no-color', parent, hash]) : g.raw(['show', '--no-color', '--format=', hash]),
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
        diff: parseDiff(diffText),
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
    if (text.trim() || text.includes('Binary files')) return parseDiff(text)

    // Empty diff: unchanged files (opened from ALL FILES mode) render the stash-tree blob
    // as context; untracked files kept in the 3rd parent keep their added-lines rendering.
    try {
        const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        if (snapshot.subarray(0, 8000).includes(0)) {
            return [{ type: 'meta', oldNo: null, newNo: null, text: `Binary file ${file} not shown` }]
        }
        return snapshotToCtxLines(file, snapshot.toString('utf8'))
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
    return stashBlobAddedLines(file, snapshot)
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

export async function getStashImageVersion(hash: string, file: string): Promise<string | null> {
    const { path: p } = getRepo()
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const snapshot = await gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}:${file}`])
        .catch(() => gitBinaryBuffer(p, ['cat-file', 'blob', `${hash}^3:${file}`]))
        .catch(() => null)
    if (!snapshot?.length) return null
    return `data:${mime};base64,${snapshot.toString('base64')}`
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
    branchCache.set(p, result)
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
    if (status.current === target) {
        const clean = status.files.length === 0
        const headBefore = clean ? await g.revparse(['HEAD']).then(out => out.trim()).catch(() => null) : null
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
    else await authedPush(['--set-upstream', 'origin', branch as string, ...(force ? ['--force-with-lease'] : [])])
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
    await withAuthEnv(git => git.push(['--set-upstream', 'origin', name, ...flags]))
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
    const oldTip = (await g.raw(['rev-parse', name])).trim()
    const fetched = (await g.raw(['rev-parse', 'FETCH_HEAD'])).trim()
    const base = (await g.raw(['merge-base', name, 'FETCH_HEAD'])).trim()
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
    const bisectActive = fs.existsSync(path.join(gitDir, 'BISECT_START')) || fs.existsSync(path.join(gitDir, 'BISECT_LOG'))
    return {
        merging,
        rebasing,
        cherryPicking,
        bisectActive,
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

export async function rebaseOnto(ref: string): Promise<string> {
    const { path: p, git: g } = getRepo()
    const clean = (await g.status()).files.length === 0
    const headBefore = await g
        .revparse(['HEAD'])
        .then(out => out.trim())
        .catch(() => null)
    try {
        await g.raw(['rebase', ref])
        if (clean && headBefore) {
            pushUndo({ label: 'rebase', doneMessage: 'Rebase undone', repoPath: p, kind: 'reset', headBefore, resetMode: 'hard' })
        }
        return `Rebased onto ${ref}`
    } catch {
        const state = await getRepoState()
        if (state.rebasing || state.merging) throw new Error('Rebase stopped due to conflicts. Resolve them, then continue.')
        throw new Error('Rebase failed')
    }
}

export async function rebaseAbort(): Promise<void> {
    const { git: g } = getRepo()
    g.env({ ...baseEnv(), GIT_EDITOR: 'true' })
    try {
        await g.raw(['rebase', '--abort'])
    } finally {
        g.env(baseEnv())
    }
}

export async function rebaseContinue(): Promise<void> {
    const { git: g } = getRepo()
    g.env({ ...baseEnv(), GIT_EDITOR: 'true' })
    try {
        await g.raw(['rebase', '--continue'])
    } finally {
        g.env(baseEnv())
    }
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

export async function renameBranch(oldName: string, newName: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['branch', '-m', oldName, newName])
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
    if (text.trim() || text.includes('Binary files')) return parseDiff(text)

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
    return snapshotToCtxLines(file, content)
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

export async function getCommitImageVersion(hash: string, file: string): Promise<string | null> {
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
        return snapshot.length ? `data:${mime};base64,${snapshot.toString('base64')}` : null
    } catch {
        return null
    }
}

export async function getRebasePlan(baseRef: string): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
    const text = await g.raw(['log', '--reverse', `--pretty=format:${fmt}${REC}`, `${baseRef}..HEAD`, '--'])
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

export async function getLastCommitMessage(): Promise<string> {
    const { git: g } = getRepo()
    return (await g.raw(['log', '-1', '--format=%B'])).trim()
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
        `--format=%(refname:short)${SEP}%(*objectname)${SEP}%(objectname)`,
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

export async function pushTags(): Promise<string> {
    await withAuthEnv(git => git.push(['origin', '--tags']))
    return 'Tags pushed'
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

export async function removeRemote(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['remote', 'remove', name])
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
        parts.push(`Changed files (staged for commit):\n${stagedFiles.join('\n')}`)
        try {
            const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
            if (staged.trim()) parts.push(staged)
        } catch {}
        return parts.join('\n')
    }

    if (allLines.length) parts.push(`Changed files:\n${allLines.join('\n')}`)
    try {
        const staged = await g.raw(['diff', '--cached', '--no-color', '--no-ext-diff'])
        const unstaged = await g.raw(['diff', '--no-color', '--no-ext-diff'])
        if (staged.trim()) parts.push(staged)
        if (unstaged.trim()) parts.push(unstaged)
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
    const tmp = path.join(path.dirname(getRepo().path), '.git', `git-cano-patch-${Date.now()}.patch`)
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

const BACKUP_FILE = 'git-cano-rebase-backup'

function backupPath(): string {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    return path.join(gitDir, BACKUP_FILE)
}

export async function executeRebasePlan(baseRef: string, entries: RebaseEntry[], resume: boolean): Promise<RebaseOutcome> {
    const { path: p, git: g } = getRepo()

    const backupFile = backupPath()
    const status = await g.status()
    const branch = status.current

    let origHead: string
    if (resume) {
        if (!fs.existsSync(backupFile)) throw new Error('No paused rebase found')
        origHead = fs.readFileSync(backupFile, 'utf8').trim()
    } else {
        if (!entries.length) throw new Error('Nothing to rebase')
        // The plan starts with `reset --hard`, which would silently discard uncommitted work.
        if (status.files.length > 0) throw new Error('Commit or stash your changes first')
        origHead = await g.revparse(['HEAD'])
        fs.writeFileSync(backupFile, origHead)
        await g.raw(['reset', '--hard', baseRef])
    }

    const rollback = async () => {
        await g.raw(['cherry-pick', '--abort']).catch(() => {})
        await g.raw(['reset', '--hard', origHead]).catch(() => {})
        if (branch && branch !== 'HEAD') await g.checkout(branch).catch(() => {})
        fs.promises.unlink(backupFile).catch(() => {})
    }

    try {
        for (const entry of entries) {
            if (entry.command === 'drop') continue
            // oxlint-disable-next-line no-await-in-loop
            await g.raw(['cherry-pick', '--allow-empty', '--keep-redundant-commits', entry.hash])

            switch (entry.command) {
                case 'reword':
                    // oxlint-disable-next-line no-await-in-loop
                    await g.commit(entry.message || 'Reworded commit', undefined, { '--amend': null })
                    break
                case 'squash':
                case 'fixup': {
                    // oxlint-disable-next-line no-await-in-loop
                    await g.raw(['reset', '--soft', 'HEAD~1'])
                    // oxlint-disable-next-line no-await-in-loop
                    if (entry.command === 'squash' && entry.message?.trim()) await g.commit(entry.message)
                    // oxlint-disable-next-line no-await-in-loop
                    else await g.raw(['commit', '--no-edit'])
                    break
                }
                case 'edit':
                    return { completed: false, message: `Paused at ${entry.hash.slice(0, 7)} for editing` }
                case 'split':
                    // oxlint-disable-next-line no-await-in-loop
                    await g.raw(['reset', '--soft', 'HEAD~1'])
                    return { completed: false, message: `Paused after unpacking ${entry.hash.slice(0, 7)} — its changes are staged` }
            }
        }

        fs.promises.unlink(backupFile).catch(() => {})
        const replayed = entries.filter(e => e.command !== 'drop').length
        pushUndo({ label: 'rebase', doneMessage: 'Rebase undone', repoPath: p, kind: 'reset', headBefore: origHead.trim(), resetMode: 'hard' })
        return { completed: true, message: `Interactive rebase complete (${replayed} commits)` }
    } catch {
        await rollback()
        throw new Error('Rebase failed — repository restored to its original state')
    }
}

export async function abortPausedRebase(): Promise<void> {
    const { git: g } = getRepo()
    const backupFile = backupPath()
    if (!fs.existsSync(backupFile)) throw new Error('No paused rebase to abort')
    const origHead = fs.readFileSync(backupFile, 'utf8').trim()
    await g.raw(['cherry-pick', '--abort']).catch(() => {})
    await g.raw(['reset', '--hard', origHead])
    const status = await g.status()
    if (status.current !== 'HEAD' && status.current) await g.checkout(status.current).catch(() => {})
    fs.promises.unlink(backupFile).catch(() => {})
}

export async function bisectStart(badRef: string, goodRef?: string): Promise<void> {
    const { git: g } = getRepo()
    const args = ['bisect', 'start', badRef]
    if (goodRef?.trim()) args.push(goodRef.trim())
    await g.raw(args)
}

export async function bisectMark(kind: 'good' | 'bad' | 'skip'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['bisect', kind])
}

export async function bisectReset(): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['bisect', 'reset'])
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
    const { git: g } = getRepo()
    const text = await g.raw(['worktree', 'list', '--porcelain'])
    const result: WorktreeInfo[] = []
    let currentWt: Partial<WorktreeInfo> = {}
    for (const line of text.split('\n')) {
        if (line.startsWith('worktree ')) {
            if (currentWt.path) result.push(finalizeWorktree(currentWt))
            currentWt = { path: line.slice('worktree '.length) }
        } else if (line.startsWith('HEAD ')) currentWt.head = line.slice(5)
        else if (line.startsWith('branch ')) currentWt.branch = line.slice('branch refs/heads/'.length)
    }
    if (currentWt.path) result.push(finalizeWorktree(currentWt))
    return result
}
function finalizeWorktree(wt: Partial<WorktreeInfo>): WorktreeInfo {
    return { path: wt.path ?? '', head: wt.head ?? '', branch: wt.branch ?? null }
}

export async function addWorktree(dir: string, newBranch?: string): Promise<void> {
    const { git: g } = getRepo()
    if (!dir.trim()) throw new Error('Path is required')
    const args = ['worktree', 'add']
    if (newBranch?.trim()) args.push('-b', newBranch.trim())
    args.push(dir.trim())
    if (newBranch?.trim()) args.push('HEAD')
    await g.raw(args)
}

export async function removeWorktree(dir: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['worktree', 'remove', dir])
}

export function listSubmodules(): string[] {
    const { path: p } = getRepo()
    const modulesFile = path.join(p, '.gitmodules')
    if (!fs.existsSync(modulesFile)) return []
    const content = fs.readFileSync(modulesFile, 'utf8')
    return [...content.matchAll(/submodule "([^"]+)"/g)].map(match => match[1])
}

export async function updateSubmodules(): Promise<string> {
    await withAuthEnv(git => git.submoduleUpdate(['--init', '--recursive']))
    return 'Submodules updated'
}
