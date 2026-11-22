import * as fs from 'node:fs'
import * as path from 'node:path'

import { escapeGitignorePath } from '../parsers'
import { getRepo, getRepoFor } from './repo'
import { gitBinaryBuffer } from './util'

import type { GitignoreRuleKind } from '@shared/types'

/** Repository file-list slice: tracked/untracked listing and `.gitignore` rules. */

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
