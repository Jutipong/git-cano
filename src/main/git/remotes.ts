import { execFile } from 'node:child_process'

import { authGitEnv } from '../auth'
import { log, maskUrl } from '../logger'
import { baseEnv, getRepo, getRepoFor, withAuthEnv, withAuthEnvFor } from './repo'
import { hasRemoteCache } from './state'

import type { RemoteTestResult } from '@shared/types'

/** Remote slice: fetch/push/pull, remote config and connectivity checks. */

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
    const { path: p, git: g } = getRepo()
    const cached = hasRemoteCache.get(p)
    if (cached !== undefined) return cached
    const remotes = await g.getRemotes()
    const value = remotes.length > 0
    hasRemoteCache.set(p, value)
    return value
}

export async function listRemotes(): Promise<{ name: string; url: string }[]> {
    const { git: g } = getRepo()
    const remotes = await g.getRemotes(true)
    return remotes.map(r => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }))
}

export function sshHostFromUrl(url: string): string | null {
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
    const { path: p, git: g } = getRepo()
    if (!name.trim() || !url.trim()) throw new Error('Name and URL are required')
    await g.raw(['remote', 'add', name.trim(), url.trim()])
    hasRemoteCache.delete(p)
}

export async function setRemoteUrl(name: string, url: string): Promise<void> {
    const { path: p, git: g } = getRepo()
    if (!url.trim()) throw new Error('URL is required')
    await g.raw(['remote', 'set-url', name, url.trim()])
    hasRemoteCache.delete(p)
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
