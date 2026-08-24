import { simpleGit, type SimpleGit } from 'simple-git'
import * as path from 'node:path'
import type { BranchInfo, CommitNode, DiffLine, FileEntry, RepoStatus } from '@shared/types'

let repoPath: string | null = null
let git: SimpleGit | null = null

export function getRepo(): { path: string; git: SimpleGit } {
  if (!repoPath || !git) throw new Error('No repository opened')
  return { path: repoPath, git }
}

export async function openRepo(dir: string): Promise<RepoStatus> {
  const g = simpleGit(dir)
  if (!(await g.checkIsRepo())) {
    throw new Error(`"${dir}" is not a git repository`)
  }
  repoPath = dir
  git = g
  return getStatus()
}

export function closeRepo(): void {
  repoPath = null
  git = null
}

export function isOpen(): boolean {
  return repoPath !== null
}

/* ---------------- Status ---------------- */

export async function getStatus(): Promise<RepoStatus> {
  const { path: p, git: g } = getRepo()
  const status = await g.status()

  const files: FileEntry[] = status.files.map((f) => ({
    path: f.path,
    staged: f.index === '?' ? 'A' : f.index,
    unstaged: f.working_dir,
  }))
  // sort: staged first, then unstaged, then untracked — alphabetical within group
  const rank = (f: FileEntry) => (f.staged !== ' ' && f.staged !== '' ? 0 : f.unstaged === '?' ? 2 : 1)
  files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))

  const branch = status.current ?? 'HEAD (detached)'
  const ahead = status.ahead ?? 0
  const behind = status.behind ?? 0
  const tracking = status.tracking ?? null

  return { path: p, name: path.basename(p), branch, tracking, ahead, behind, files }
}

/* ---------------- Log / Graph ---------------- */

export async function getLog(limit = 500): Promise<CommitNode[]> {
  const { git: g } = getRepo()
  const SEP = '\x1f'
  const REC = '\x1e'
  const fmt = ['%H', '%P', '%h', '%an', '%ad', '%d', '%s'].join(SEP)

  const text = await g.raw([
    'log',
    '--all',
    `--pretty=format:${fmt}${REC}`,
    '--date=iso',
    '--max-count=' + limit,
    '--',
  ])

  const commits: CommitNode[] = []
  for (const line of text.split(REC)) {
    const t = line.replace(/^\n/, '')
    if (!t.trim()) continue
    const [hash, parents, shortHash, author, date, refsRaw, subject] = t.split(SEP)
    const refs = refsRaw
      ? refsRaw
          .trim()
          .replace(/^\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    commits.push({
      hash,
      shortHash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author,
      date,
      subject,
      refs,
      lane: 0,
    })
  }
  assignLanes(commits)
  return commits
}

/** Assign each commit to a visual lane (classic first-parent lane allocator). */
function assignLanes(commits: CommitNode[]): void {
  const lanes: string[] = [] // tip hash per lane
  for (const c of commits) {
    let idx = lanes.indexOf(c.hash)
    if (idx === -1) {
      lanes.push(c.hash)
      idx = lanes.length - 1
    }
    c.lane = idx
    lanes.splice(idx, 1)

    c.parents.forEach((parent, i) => {
      if (!commits.some((x) => x.hash === parent)) return // parent beyond log window
      const pi = lanes.indexOf(parent)
      if (pi === -1) {
        if (i === 0) lanes.splice(idx, 0, parent) // first parent inherits position
        else lanes.push(parent)
      }
    })
  }
}

/* ---------------- Staging & Commit ---------------- */

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
  // use rm --cached --ignore-unmatch so it works in fresh repos without HEAD too
  await g.raw(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', ...paths])
  await g.reset(['HEAD', '--', ...paths]).catch(() => {}) // ignore when no HEAD yet
}

export async function unstageAll(): Promise<void> {
  const { git: g } = getRepo()
  const status = await g.status()
  const paths = status.files.map((f) => f.path)
  if (paths.length) await unstage(paths)
}

export async function discard(path_: string): Promise<void> {
  const { git: g } = getRepo()
  const status = await g.status()
  const file = status.files.find((f) => f.path === path_)
  if (!file) return
  if (file.working_dir === '?') {
    // untracked -> delete file
    await g.raw(['clean', '-f', '--', path_])
  } else {
    await g.checkout(['--', path_])
  }
}

export async function commit(message: string): Promise<string> {
  const { git: g } = getRepo()
  const res = await g.commit(message)
  return res.commit
}

/* ---------------- Diff ---------------- */

export async function getDiff(file: string, staged: boolean): Promise<DiffLine[]> {
  const { git: g } = getRepo()
  const args = staged ? ['diff', '--cached', '--no-color', '--', file] : ['diff', '--no-color', '--', file]
  let text = ''
  try {
    text = await g.raw(args)
  } catch {
    /* empty diff */
  }
  return parseDiff(text, file)
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

export async function getCommitDetails(hash: string): Promise<import('@shared/types').CommitDetails> {
  const { git: g } = getRepo()
  const [metadata, message, diffText, fileText] = await Promise.all([
    g.raw(['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P', hash]),
    g.raw(['show', '-s', '--format=%B', hash]),
    g.raw(['show', '--no-color', '--format=', hash]),
    g.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
  ])
  const [fullHash, author, email, date, parents = ''] = metadata.trim().split('\x1f')
  const files = fileText.trim().split('\n').filter(Boolean).map((line) => {
    const [status, ...pathParts] = line.split('\t')
    return { path: pathParts.join('\t'), status, additions: 0, deletions: 0 }
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

/* ---------------- Stash ---------------- */

export async function listStashes(): Promise<import('@shared/types').StashEntry[]> {
  const { git: g } = getRepo()
  const raw = await g.raw(['stash', 'list', '--format=%gd%x1f%H%x1f%ci%x1f%s'])
  return raw.split('\n').filter(Boolean).map((line) => {
    const [ref, hash, date, ...messageParts] = line.split('\x1f')
    const match = /stash@\{(\d+)\}/.exec(ref)
    return { index: match ? Number(match[1]) : 0, hash, date, message: messageParts.join('\x1f') }
  })
}

export async function createStash(message: string, includeUntracked: boolean): Promise<void> {
  const { git: g } = getRepo()
  const args = ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', message || 'WIP']
  await g.raw(args)
}

export async function applyStash(index: number, pop: boolean): Promise<void> {
  const { git: g } = getRepo()
  await g.raw(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function dropStash(index: number): Promise<void> {
  const { git: g } = getRepo()
  await g.raw(['stash', 'drop', `stash@{${index}}`])
}

export async function revertCommit(hash: string): Promise<void> {
  const { git: g } = getRepo()
  await g.raw(['revert', '--no-edit', hash])
}

export async function checkoutCommit(hash: string): Promise<void> {
  const { git: g } = getRepo()
  await g.checkout(hash)
}

/* ---------------- Branches ---------------- */

export async function listBranches(): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> {
  const { git: g } = getRepo()
  const b = await g.branch(['-a'])
  const local: BranchInfo[] = []
  const remote: BranchInfo[] = []
  for (const ref of b.all) {
    if (ref.includes('HEAD') || ref.includes('->')) continue
    const info: BranchInfo = { name: ref, current: b.current === ref }
    if (ref.startsWith('remotes/') || !b.branches[ref]) remote.push(info)
    else local.push(info)
  }
  return { local, remote }
}

export async function createBranch(name: string, checkout: boolean): Promise<void> {
  const { git: g } = getRepo()
  if (checkout) await g.checkoutBranch(name, 'HEAD')
  else await g.raw(['branch', name])
}

export async function checkout(ref: string): Promise<void> {
  const { git: g } = getRepo()
  await g.checkout(ref)
}

export async function deleteBranch(name: string): Promise<void> {
  const { git: g } = getRepo()
  await g.deleteLocalBranch(name, true /* force */)
}

export async function merge(name: string): Promise<string> {
  const { git: g } = getRepo()
  const res = await g.merge([name, '--no-edit'])
  return res.result || 'Merged'
}

/* ---------------- Remotes ---------------- */

export async function fetchAll(): Promise<string> {
  const { git: g } = getRepo()
  await g.fetch(['--all'])
  return 'Fetch completed'
}

export async function push(): Promise<string> {
  const { git: g } = getRepo()
  const status = await g.status()
  const branch = status.current
  const tracking = status.tracking
  const res = tracking
    ? await g.push()
    : await g.push(['--set-upstream', 'origin', branch as string])
  return 'Pushed successfully'
}

export async function pull(): Promise<string> {
  const { git: g } = getRepo()
  const res = await g.pull(['--no-rebase'])
  return `Pulled (${res.summary.changes} changes)`
}

export async function hasRemote(): Promise<boolean> {
  const { git: g } = getRepo()
  const remotes = await g.getRemotes()
  return remotes.length > 0
}

/* ---------------- Repo state / conflicts / rebase / advanced ---------------- */

import * as fs from 'node:fs'

export async function getRepoState(): Promise<import('@shared/types').RepoState> {
  const { path: p } = getRepo()
  const gitDir = fs.existsSync(path.join(p, '.git')) ? path.join(p, '.git') : p
  const merging = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
  const rebasing =
    fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))
  return { merging, rebasing }
}

export async function checkoutSide(file: string, side: 'ours' | 'theirs'): Promise<void> {
  const { git: g } = getRepo()
  await g.raw(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file])
  await g.add(file)
}

export async function markResolved(files: string[]): Promise<void> {
  const { git: g } = getRepo()
  await g.add(files)
}

export async function continueMerge(): Promise<void> {
  const { git: g } = getRepo()
  await g.commit(['--no-edit'])
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
    // conflict or error — state is exposed via getRepoState(); caller decides to abort/continue
    const state = await getRepoState()
    if (state.rebasing || state.merging) throw new Error('Rebase stopped due to conflicts. Resolve them, then continue.')
    throw new Error('Rebase failed')
  }
}

export async function rebaseAbort(): Promise<void> {
  const { git: g } = getRepo()
  await g.env({ ...process.env, GIT_EDITOR: 'true' }).raw(['rebase', '--abort'])
}

export async function rebaseContinue(): Promise<void> {
  const { git: g } = getRepo()
  await g.env({ ...process.env, GIT_EDITOR: 'true' }).raw(['rebase', '--continue'])
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

export async function getCommitFileDiff(hash: string, file: string): Promise<DiffLine[]> {
  const { git: g } = getRepo()
  let text = ''
  try {
    text = await g.raw(['show', '--no-color', '--format=', hash, '--', file])
  } catch {
    /* empty */
  }
  return parseDiff(text)
}

/* ---------------- Interactive rebase (todo editor) ---------------- */

export async function getRebasePlan(baseRef: string): Promise<CommitNode[]> {
  const { git: g } = getRepo()
  const SEP = '\x1f'
  const REC = '\x1e'
  const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(SEP)
  const text = await g.raw(['log', '--reverse', `--pretty=format:${fmt}${REC}`, `${baseRef}..HEAD`, '--'])
  return text
    .split(REC)
    .map((line) => line.replace(/^\n/, ''))
    .filter((line) => line.trim())
    .map((line) => {
      const [hash, shortHash, author, date, subject] = line.split(SEP)
      return { hash, shortHash, parents: [], author, date, subject, refs: [], lane: 0 }
    })
}

export interface RebaseEntry {
  command: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
  hash: string
  message?: string
}

export async function executeRebase(entries: RebaseEntry[], baseRef: string): Promise<string> {
  const { git: g } = getRepo()
  if (!entries.length) throw new Error('Nothing to rebase')
  const active = entries.filter((entry) => entry.command !== 'drop')
  if (!active.length) throw new Error('Cannot drop every commit')

  const status = await g.status()
  const branch = status.current
  const origHead = await g.revparse(['HEAD'])

  const rollback = async () => {
    await g.raw(['cherry-pick', '--abort']).catch(() => {})
    await g.raw(['reset', '--hard', origHead]).catch(() => {})
    if (branch && branch !== 'HEAD') await g.checkout(branch).catch(() => {})
  }

  try {
    await g.raw(['reset', '--hard', baseRef])
    for (const entry of active) {
      await g.raw(['cherry-pick', '--allow-empty', '--keep-redundant-commits', entry.hash])
      if (entry.command === 'reword') {
        await g.commit(['--amend', '-m', entry.message || 'Reworded commit'])
      } else if (entry.command === 'squash' || entry.command === 'fixup') {
        await g.raw(['reset', '--soft', 'HEAD~1'])
        if (entry.command === 'squash') {
          await g.commit(['-m', entry.message?.trim() || 'Squashed commit'])
        } else {
          await g.commit(['--no-edit'])
        }
      }
    }
    return `Interactive rebase complete (${active.length} commits replayed)`
  } catch (err) {
    await rollback()
    throw new Error('Rebase failed — repository restored to its original state')
  }
}
