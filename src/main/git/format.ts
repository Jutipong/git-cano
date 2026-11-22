import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { getRepo, getRepoFor } from './repo'

/** Formatter slice: runs the repository's own formatter before AI commit-message generation. */

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
