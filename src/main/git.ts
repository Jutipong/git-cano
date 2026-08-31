import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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
    MergeCheck,
    MergeMode,
    RebaseEntry,
    RebaseOutcome,
    RemoteTestResult,
    RepoState,
    RepoStatus,
    StashEntry,
    WorktreeInfo,
    AiContextScope,
    ConflictVersions,
} from '@shared/types'
import type { FSWatcher } from 'node:fs'

const repoInstances = new Map<string, SimpleGit>()
let activeRepoPath: string | null = null

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

/** One-off git instance for standalone commands (init/clone) outside repo sessions. */
export function plainGit(dir = ''): SimpleGit {
    const git = simpleGit(dir, SAFE_UNSAFE_OPTIONS)
    git.env(baseEnv())
    return git
}

export function getRepo(): { path: string; git: SimpleGit } {
    if (!activeRepoPath) throw new Error('No repository opened')
    const instance = repoInstances.get(activeRepoPath)
    if (!instance) throw new Error('Active repository is not registered')
    return { path: activeRepoPath, git: instance }
}

export async function openRepo(dir: string): Promise<RepoStatus> {
    const g = repoInstances.get(dir) ?? createGit(dir)
    if (!(await g.checkIsRepo())) {
        throw new Error(`"${dir}" is not a git repository`)
    }
    const reopened = repoInstances.has(dir)
    repoInstances.set(dir, g)
    activeRepoPath = dir
    watchRepo(dir)
    log('info', 'repo', `${reopened ? 'reopen' : 'open'} ${dir}`)
    return getStatus()
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

export async function getStatus(): Promise<RepoStatus> {
    const { path: p, git: g } = getRepo()
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

    return { path: p, name: path.basename(p), branch, tracking, ahead, behind, files }
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

export async function getLog(limit = 500): Promise<CommitNode[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const REC = '\x1e'
    const fmt = ['%H', '%P', '%h', '%an', '%aE', '%ad', '%d', '%s', '%b'].join(SEP)

    const text = await g.raw([
        'log',
        '--branches',
        '--remotes',
        '--tags',
        `--pretty=format:${fmt}${REC}`,
        '--date=iso',
        `--max-count=${limit}`,
        '--',
    ])

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
                  .map(s => s.trim())
                  .filter(Boolean)
                  .filter(ref => !ref.endsWith('/HEAD'))
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
    assignLanes(commits)
    return commits
}

function assignLanes(commits: CommitNode[]): void {
    const lanes: string[] = []
    for (const c of commits) {
        let idx = lanes.indexOf(c.hash)
        if (idx === -1) {
            lanes.push(c.hash)
            idx = lanes.length - 1
        }
        c.lane = idx
        lanes.splice(idx, 1)

        c.parents.forEach((parent, i) => {
            if (!commits.some(x => x.hash === parent)) return
            const pi = lanes.indexOf(parent)
            if (pi === -1) {
                if (i === 0) lanes.splice(idx, 0, parent)
                else lanes.push(parent)
            }
        })
    }
}

export async function stage(paths: string[]): Promise<void> {
    const { git: g } = getRepo()
    await g.add(paths)
}

export async function stageAll(): Promise<void> {
    const { git: g } = getRepo()
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
    return parseDiff(text, file)
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
    const [metadata, message, diffText, fileText, numstatText] = await Promise.all([
        g.raw(['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P', hash]),
        g.raw(['show', '-s', '--format=%B', hash]),
        g.raw(['show', '--no-color', '--format=', hash]),
        g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
        g.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
    ])
    const [fullHash, author, email, date, parents = ''] = metadata.trim().split('\u001f')

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
    const { git: g } = getRepo()
    await g.raw(['stash', 'drop', `stash@{${index}}`])
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
    const { git: g } = getRepo()
    await g.raw(['revert', '--no-edit', hash])
}

export async function checkoutCommit(hash: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(hash)
}

export async function listBranches(): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> {
    const { git: g } = getRepo()
    const b = await g.branch(['-a'])
    const local: BranchInfo[] = []
    const remote: BranchInfo[] = []

    const trackText = await g.raw([
        'for-each-ref',
        '--format=%(refname:short)|%(upstream:track)|%(objectname)',
        'refs/heads',
        'refs/remotes',
    ])
    const track = new Map<string, { ahead?: number; behind?: number; commitHash?: string }>()
    for (const line of trackText.split('\n')) {
        if (!line.trim()) continue
        const [name, t = '', commitHash = ''] = line.split('|')
        if (name.endsWith('/HEAD')) continue
        const ahead = /\bahead (\d+)/.exec(t)?.[1]
        const behind = /\bbehind (\d+)/.exec(t)?.[1]
        track.set(name, {
            ...(ahead ? { ahead: Number(ahead) } : {}),
            ...(behind ? { behind: Number(behind) } : {}),
            ...(commitHash ? { commitHash } : {}),
        })
    }

    const detachedSha = b.detached && b.current ? await g.revparse(['HEAD']).catch(() => '') : ''

    for (const ref of b.all) {
        if (ref.includes('HEAD') || ref.includes('->')) continue
        const info: BranchInfo = { name: ref, current: b.current === ref }
        Object.assign(info, track.get(ref) ?? track.get(ref.replace(/^remotes\//, '')))
        if (b.detached && b.current === ref) {
            info.detached = true
            if (detachedSha) info.commitHash = detachedSha
        }
        if (ref.startsWith('remotes/') || !b.branches[ref]) remote.push(info)
        else local.push(info)
    }
    return { local, remote }
}

export async function createBranch(name: string, checkout: boolean, startPoint?: string): Promise<void> {
    const { git: g } = getRepo()
    const start = startPoint || 'HEAD'
    if (checkout) await g.checkoutBranch(name, start)
    else await g.raw(['branch', name, start])
}

export async function checkout(ref: string): Promise<void> {
    const { git: g } = getRepo()
    await g.checkout(ref)
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
    const { git: g } = getRepo()
    const status = await g.status()
    if (status.current === target) {
        const args: string[] = [source]
        if (mode === 'no-ff') args.push('--no-ff')
        else if (mode === 'ff-only') args.push('--ff-only')
        args.push('--no-edit')
        const res = await g.merge(args)
        return res.result || 'Merged'
    }

    const ff = await isFastForward(g, source, target)
    if (mode === 'ff-only') {
        if (!ff) throw new Error(`"${target}" cannot be fast-forwarded to "${source}"`)
        // Updates the branch ref without any checkout (refuses non-ff).
        await g.raw(['fetch', '.', `refs/heads/${source}:refs/heads/${target}`])
        return `Fast-forwarded ${target} to ${source}`
    }
    if (mode === 'default' && ff) {
        await g.raw(['fetch', '.', `refs/heads/${source}:refs/heads/${target}`])
        return `Fast-forwarded ${target} to ${source}`
    }

    const tmp = path.join(os.tmpdir(), `open-git-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    let worktreeFailed: unknown = null
    try {
        await g.raw(['worktree', 'add', tmp, target])
        await createGit(tmp).merge(mode === 'no-ff' ? [source, '--no-ff', '--no-edit'] : [source, '--no-edit'])
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
    await withAuthEnv(git => git.fetch(['--all', '--tags']))
    return 'Fetch completed'
}

export async function push(): Promise<string> {
    const { git: g } = getRepo()
    const status = await g.status()
    const branch = status.current
    const tracking = status.tracking
    if (tracking) await withAuthEnv(git => git.push())
    else await withAuthEnv(git => git.push(['--set-upstream', 'origin', branch as string]))
    return 'Pushed successfully'
}

export async function pull(): Promise<string> {
    const res = await withAuthEnv(git => git.pull(['--no-rebase']))
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

export function getRepoState(): RepoState {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    const merging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
    const rebasing = fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
    const bisectActive = fs.existsSync(path.join(gitDir, 'BISECT_START')) || fs.existsSync(path.join(gitDir, 'BISECT_LOG'))
    return { merging, rebasing, bisectActive, mergeSource: merging ? mergeSourceName(gitDir) : null }
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
    const { git: g } = getRepo()
    try {
        await g.raw(['rebase', ref])
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
    const { git: g } = getRepo()
    await g.raw(['cherry-pick', hash])
}

export async function resetTo(target: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['reset', `--${mode}`, target])
}

export async function renameBranch(oldName: string, newName: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['branch', '-m', oldName, newName])
}

export async function getCommitFileDiff(hash: string, file: string, context?: number): Promise<DiffLine[]> {
    const { path: p, git: g } = getRepo()
    let text = ''
    try {
        text = await g.raw(['show', `--unified=${context ?? 3}`, '--no-color', '--format=', hash, '--', file])
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
    const snapshotLines = content.split('\n')
    if (snapshotLines[snapshotLines.length - 1] === '') snapshotLines.pop()
    const lines: DiffLine[] = [{ type: 'meta', oldNo: null, newNo: null, text: `snapshot ${file}` }]
    lines.push({ type: 'hunk', oldNo: null, newNo: null, text: `@@ -1,${snapshotLines.length} +1,${snapshotLines.length} @@` })
    snapshotLines.forEach((line, index) => {
        lines.push({ type: 'ctx', oldNo: index + 1, newNo: index + 1, text: ` ${line}` })
    })
    return lines
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

export async function commitMessage(message: string, amend: boolean): Promise<string> {
    const { git: g } = getRepo()
    if (amend && !message.trim()) throw new Error('Enter a message to amend with')
    const res = amend ? await g.commit(message, undefined, { '--amend': null }) : await g.commit(message)
    return res.commit
}

export async function getLastCommitMessage(): Promise<string> {
    const { git: g } = getRepo()
    return (await g.raw(['log', '-1', '--format=%B'])).trim()
}

export interface TagRef {
    name: string
    hash: string
}

export async function listTags(): Promise<TagRef[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const text = await g.raw(['for-each-ref', 'refs/tags', `--format=%(refname:short)${SEP}%(*objectname)${SEP}%(objectname)`])
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
    try {
        const out = await withAuthEnv(git => git.raw(['ls-remote', '--tags', 'origin']))
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

export async function getChangesContext(scope: AiContextScope = 'staged'): Promise<string> {
    const { path: p, git: g } = getRepo()
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
                        const content = fs.readFileSync(path.join(p, file), 'utf8').slice(0, 2000)
                        return `--- ${file} (new) ---\n${content}`
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
export function formatRepoIfConfigured(): Promise<void> {
    const repoRoot = getRepo().path
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
    const tmp = path.join(path.dirname(getRepo().path), '.git', `open-git-patch-${Date.now()}.patch`)
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

export async function getBlame(file: string): Promise<BlameLine[]> {
    const { git: g } = getRepo()
    const text = await g.raw(['blame', '--line-porcelain', '--', file])
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
            })
            continue
        }
        const spaceAt = line.indexOf(' ')
        const key = spaceAt === -1 ? line : line.slice(0, spaceAt)
        const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1)
        if (/^[0-9a-f]{40}$/.test(key)) current.hash = key
        else if (key === 'author') current.author = value
        else if (key === 'author-time') current.date = new Date(parseInt(value, 10) * 1000).toISOString()
        else if (/^\d+$/.test(key)) current.lineNumber = parseInt(key, 10)
    }
    return result
}

const BACKUP_FILE = 'open-git-rebase-backup'

function backupPath(): string {
    const { path: p } = getRepo()
    const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
    return path.join(gitDir, BACKUP_FILE)
}

export async function executeRebasePlan(baseRef: string, entries: RebaseEntry[], resume: boolean): Promise<RebaseOutcome> {
    const { git: g } = getRepo()

    const backupFile = backupPath()
    const status = await g.status()
    const branch = status.current

    let origHead: string
    if (resume) {
        if (!fs.existsSync(backupFile)) throw new Error('No paused rebase found')
        origHead = fs.readFileSync(backupFile, 'utf8').trim()
    } else {
        if (!entries.length) throw new Error('Nothing to rebase')
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
