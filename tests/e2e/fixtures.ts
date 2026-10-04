import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface Fixtures {
    root: string
    mainRepo: string
    /** extra-1 … extra-7 — one-commit repos used for the cache/LRU checks. */
    extraRepos: string[]
    /** Repo left mid-merge with an unmerged `shared.txt`. */
    conflictRepo: string
    /** Clean 5-commit repo for history operations (undo/squash/rebase/reflog). */
    opsRepo: string
    /** Bare remote + two clones for push/pull/fetch tests. */
    remote: { bare: string; main: string; peer: string }
    /** Clean 1-commit repo for stash/tag tests. */
    stashRepo: string
    /** 5,000-commit repo (bodies included) for log/memory benchmarks. */
    bulkRepo: string
    /** 1-commit repo with a 100k-line file modified in the worktree, for entire-file benchmarks. */
    hugeRepo: string
}

const META_FILE = path.join(os.tmpdir(), 'git-cano-e2e-fixtures.json')

function run(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function configureRepo(dir: string): void {
    run(dir, ['config', 'user.name', 'E2E User'])
    run(dir, ['config', 'user.email', 'e2e@example.com'])
    run(dir, ['config', 'commit.gpgsign', 'false'])
    run(dir, ['config', 'core.autocrlf', 'false'])
}

function initRepo(dir: string): void {
    fs.mkdirSync(dir, { recursive: true })
    run(dir, ['init', '-b', 'main'])
    configureRepo(dir)
}

function write(dir: string, file: string, content: string): void {
    const full = path.join(dir, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
}

function commit(dir: string, message: string, body?: string): void {
    const args = ['commit', '-m', message]
    if (body) args.push('-m', body)
    run(dir, args)
}

/** Two valid 1x1 PNGs (distinct bytes so the image diff has two real versions). */
const PNG_A = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
)
const PNG_B = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
)

/** Deterministic 1024×1024 24-bit BMP (~3MB) — makes the base64-vs-raw image path measurable. */
function makeBmp(seed: number): Buffer {
    const width = 1024
    const height = 1024
    const rowSize = Math.ceil((width * 3) / 4) * 4
    const pixelDataSize = rowSize * height
    const buf = Buffer.alloc(54 + pixelDataSize)
    buf.write('BM', 0)
    buf.writeUInt32LE(buf.length, 2)
    buf.writeUInt32LE(54, 10)
    buf.writeUInt32LE(40, 14)
    buf.writeInt32LE(width, 18)
    buf.writeInt32LE(height, 22)
    buf.writeUInt16LE(1, 26)
    buf.writeUInt16LE(24, 28)
    buf.writeUInt32LE(pixelDataSize, 34)
    let s = seed >>> 0
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            s = (Math.imul(s, 1103515245) + 12345) >>> 0
            const at = 54 + y * rowSize + x * 3
            buf[at] = s & 0xff
            buf[at + 1] = (s >>> 8) & 0xff
            buf[at + 2] = (s >>> 16) & 0xff
        }
    }
    return buf
}

function createMainRepo(root: string): string {
    const dir = path.join(root, 'main-repo')
    initRepo(dir)

    write(dir, 'readme.md', '# Main repo\n')
    run(dir, ['add', 'readme.md'])
    commit(dir, 'chore: initial commit')

    // Commit with a multi-line body — the popover's lazy body fetch target.
    write(dir, 'notes.md', 'notes\n')
    run(dir, ['add', 'notes.md'])
    commit(dir, 'feat: add notes', 'Body line one\nBody line two\nBody line three')

    // Commit without a body — must not render a message toggle.
    write(dir, 'src/app.js', 'export const app = 1\n')
    run(dir, ['add', 'src/app.js'])
    commit(dir, 'chore: no body commit')

    // Cross-line tokenizer state: a block comment the change sits after.
    const stateBase = ['const a = 1', '/* start comment', 'middle line inside comment', 'end comment */', 'const value = 1', ''].join('\n')
    write(dir, 'state.js', stateBase)
    run(dir, ['add', 'state.js'])
    commit(dir, 'feat: state file')
    write(dir, 'state.js', stateBase.replace('const value = 1', 'const value = 2'))

    // Big commit — the old getCommitDetails() parsed this whole diff on every click.
    const bigLines = Array.from({ length: 6000 }, (_, i) => `big line ${i} ${'x'.repeat(40)}`)
    write(dir, 'big-commit.txt', `${bigLines.join('\n')}\n`)
    run(dir, ['add', 'big-commit.txt'])
    commit(dir, 'feat: big commit')

    // Large tracked file for the entire-file diff cap.
    const tracked = Array.from({ length: 25_000 }, (_, i) => `tracked line ${i}`)
    write(dir, 'large-tracked.txt', `${tracked.join('\n')}\n`)
    run(dir, ['add', 'large-tracked.txt'])
    commit(dir, 'chore: large tracked file')
    const trackedModified = ['tracked line 0 modified', ...tracked.slice(1)]
    write(dir, 'large-tracked.txt', `${trackedModified.join('\n')}\n`)

    // Image + JSON committed once, then modified in the worktree → two-sided image diff + previewable JSON.
    fs.writeFileSync(path.join(dir, 'img.png'), PNG_A)
    fs.writeFileSync(path.join(dir, 'big.bmp'), makeBmp(1))
    write(dir, 'data.json', `${JSON.stringify({ name: 'git-cano', features: ['graph', 'diff'] }, null, 2)}\n`)
    run(dir, ['add', 'img.png', 'big.bmp', 'data.json'])
    commit(dir, 'chore: add image')
    fs.writeFileSync(path.join(dir, 'img.png'), PNG_B)
    fs.writeFileSync(path.join(dir, 'big.bmp'), makeBmp(7))
    write(dir, 'data.json', `${JSON.stringify({ name: 'git-cano', features: ['graph', 'diff', 'preview'], version: 2 }, null, 2)}\n`)

    // Mixed diff: uneven del/add, delete-only, add-only, multiple hunks, a searchable token.
    const mixedBase = [
        'alpha',
        'beta',
        'gamma',
        'delta',
        'epsilon',
        'zeta',
        'eta',
        'theta',
        'MAGIC_TOKEN original',
        'iota',
        'kappa',
        'lambda',
        'mu',
        'nu',
        'xi',
        'omicron',
        'pi',
        'rho',
        'sigma',
        'tau',
    ].join('\n')
    write(dir, 'mixed.txt', `${mixedBase}\n`)
    run(dir, ['add', 'mixed.txt'])
    commit(dir, 'chore: mixed file')
    const mixedChanged = [
        'alpha',
        'beta',
        'gamma changed',
        'delta changed',
        'delta extra',
        'epsilon',
        'zeta',
        'eta',
        'theta',
        'MAGIC_TOKEN changed',
        'iota',
        'kappa',
        'mu',
        'nu',
        'xi',
        'omicron',
        'pi',
        'NEW LINE',
        'rho',
        'sigma',
        'tau',
    ].join('\n')
    write(dir, 'mixed.txt', `${mixedChanged}\n`)

    // Untracked 25k-line file — the untracked diff cap target.
    const untracked = Array.from({ length: 25_000 }, (_, i) => `untracked line ${i}`)
    write(dir, 'untracked-big.txt', `${untracked.join('\n')}\n`)

    // Uncommitted markdown change — the preview modal target (workdir content, not a diff).
    fs.appendFileSync(path.join(dir, 'notes.md'), '\n## Preview section\n\nRendered **markdown** content.\n')

    return dir
}

function createExtraRepos(root: string): string[] {
    const repos: string[] = []
    for (let i = 1; i <= 7; i++) {
        const dir = path.join(root, `extra-${i}`)
        initRepo(dir)
        write(dir, 'file.txt', `extra ${i}\n`)
        run(dir, ['add', 'file.txt'])
        commit(dir, `chore: extra ${i}`)
        repos.push(dir)
    }
    return repos
}

function createConflictRepo(root: string): string {
    const dir = path.join(root, 'conflict-repo')
    initRepo(dir)
    write(dir, 'shared.txt', 'line one\nshared line\nline three\n')
    run(dir, ['add', 'shared.txt'])
    commit(dir, 'chore: base')
    run(dir, ['checkout', '-b', 'feature'])
    write(dir, 'shared.txt', 'line one\nfeature side\nline three\n')
    run(dir, ['add', 'shared.txt'])
    commit(dir, 'feat: feature side')
    run(dir, ['checkout', 'main'])
    write(dir, 'shared.txt', 'line one\nmain side\nline three\n')
    run(dir, ['add', 'shared.txt'])
    commit(dir, 'feat: main side')
    try {
        run(dir, ['merge', 'feature'])
    } catch {
        // Expected: merge stops with a conflict and leaves the repo unmerged.
    }
    return dir
}

function createOpsRepo(root: string): string {
    const dir = path.join(root, 'ops-repo')
    initRepo(dir)
    for (let i = 1; i <= 5; i++) {
        write(dir, `file-${i}.txt`, `content ${i}\n`)
        run(dir, ['add', `file-${i}.txt`])
        commit(dir, `chore: commit ${i}`)
    }
    return dir
}

function createStashRepo(root: string): string {
    const dir = path.join(root, 'stash-repo')
    initRepo(dir)
    write(dir, 'work.txt', 'base\n')
    run(dir, ['add', 'work.txt'])
    commit(dir, 'chore: base')
    return dir
}

function createRemoteFixtures(root: string): { bare: string; main: string; peer: string } {
    const bare = path.join(root, 'remote.git')
    fs.mkdirSync(bare, { recursive: true })
    run(bare, ['init', '--bare', '--initial-branch=main'])

    const main = path.join(root, 'remote-main')
    run(root, ['clone', bare, main])
    configureRepo(main)
    write(main, 'readme.md', '# remote main\n')
    run(main, ['add', 'readme.md'])
    commit(main, 'chore: initial')
    run(main, ['push', '-u', 'origin', 'main'])

    const peer = path.join(root, 'remote-peer')
    run(root, ['clone', bare, peer])
    configureRepo(peer)
    run(peer, ['reset', '--hard', 'HEAD'])
    return { bare, main, peer }
}

function createBulkRepo(root: string): string {
    const dir = path.join(root, 'bulk-repo')
    initRepo(dir)
    // fast-import builds thousands of commits with bodies in well under a second.
    const chunks: string[] = []
    for (let i = 0; i < 5000; i++) {
        const message = `chore: bulk commit ${i}\n\nbody for bulk commit ${i} ${'x'.repeat(200)}\n`
        const bytes = Buffer.byteLength(message)
        chunks.push(
            `commit refs/heads/main\nmark :${i + 1}\nauthor E2E User <e2e@example.com> ${1700000000 + i} +0000\ncommitter E2E User <e2e@example.com> ${1700000000 + i} +0000\ndata ${bytes}\n${message}${i > 0 ? `from :${i}\n` : ''}`
        )
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: chunks.join(''), stdio: ['pipe', 'pipe', 'pipe'] })
    run(dir, ['reset', '--hard', 'main'])
    return dir
}

function createHugeRepo(root: string): string {
    const dir = path.join(root, 'huge-repo')
    initRepo(dir)
    const lines = Array.from({ length: 100_000 }, (_, i) => `huge line ${i}`)
    write(dir, 'huge.txt', `${lines.join('\n')}\n`)
    run(dir, ['add', 'huge.txt'])
    commit(dir, 'chore: huge file')
    write(dir, 'huge.txt', `${['huge line 0 modified', ...lines.slice(1)].join('\n')}\n`)
    return dir
}

export function createFixtures(): Fixtures {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-cano-e2e-fixtures-'))
    const fixtures: Fixtures = {
        root,
        mainRepo: createMainRepo(root),
        extraRepos: createExtraRepos(root),
        conflictRepo: createConflictRepo(root),
        opsRepo: createOpsRepo(root),
        remote: createRemoteFixtures(root),
        stashRepo: createStashRepo(root),
        bulkRepo: createBulkRepo(root),
        hugeRepo: createHugeRepo(root),
    }
    return fixtures
}

export function saveFixtures(fixtures: Fixtures): void {
    fs.writeFileSync(META_FILE, JSON.stringify(fixtures, null, 2))
}

export function loadFixtures(): Fixtures {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8')) as Fixtures
}
