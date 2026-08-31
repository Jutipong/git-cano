import { execFile, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { app, shell } from 'electron'

import { log } from './logger'

import type { AuthConfig, GithubUser, SshKeyInfo, SshTestResult } from '@shared/types'

const AUTH_FILE = 'auth.json'
const GITHUB_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=Open%20Git'
const GITHUB_API_USER = 'https://api.github.com/user'

function authPath(): string {
    return path.join(app.getPath('userData'), AUTH_FILE)
}

export function getAuthConfig(): AuthConfig {
    try {
        const raw = JSON.parse(fs.readFileSync(authPath(), 'utf8')) as Partial<AuthConfig>
        return {
            githubToken: typeof raw.githubToken === 'string' ? raw.githubToken : '',
            sshKeyPath: typeof raw.sshKeyPath === 'string' ? raw.sshKeyPath : '',
        }
    } catch {
        return { githubToken: '', sshKeyPath: '' }
    }
}

export function saveAuthConfig(cfg: AuthConfig): AuthConfig {
    const clean: AuthConfig = {
        githubToken: String(cfg.githubToken ?? '').trim(),
        sshKeyPath: String(cfg.sshKeyPath ?? ''),
    }
    const file = authPath()
    fs.writeFileSync(file, JSON.stringify(clean, null, 2))
    try {
        fs.chmodSync(file, 0o600)
    } catch {}
    log('info', 'auth', `config saved (sshKeyPath=${clean.sshKeyPath ? 'set' : 'none'}, token=${clean.githubToken ? 'set' : 'none'})`)
    return clean
}

function sshDir(): string {
    return path.join(os.homedir(), '.ssh')
}

function fingerprintOf(publicKeyPath: string): string {
    try {
        const out = execFileSync('ssh-keygen', ['-lf', publicKeyPath], { timeout: 5_000, encoding: 'utf8' })
        const firstLine = out.split('\n')[0] ?? ''
        const parts = firstLine.trim().split(/\s+/)
        return parts.length > 1 ? parts[1] : firstLine.trim()
    } catch {
        return ''
    }
}

export function listSshKeys(): SshKeyInfo[] {
    const dir = sshDir()
    let entries: string[] = []
    try {
        entries = fs.readdirSync(dir)
    } catch {
        return []
    }
    const cfg = getAuthConfig()
    const keys: SshKeyInfo[] = []
    for (const name of entries.filter(n => n.endsWith('.pub')).sort()) {
        const publicKeyPath = path.join(dir, name)
        const privateKeyPath = publicKeyPath.replace(/\.pub$/, '')
        if (!fs.existsSync(privateKeyPath)) continue
        let publicKey = ''
        try {
            publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim()
        } catch {
            continue
        }
        keys.push({
            name,
            publicKeyPath,
            privateKeyPath,
            publicKey,
            fingerprint: fingerprintOf(publicKeyPath),
            active: cfg.sshKeyPath === privateKeyPath,
        })
    }
    return keys
}

/**
 * Permanently removes a key pair (private + `.pub`) from ~/.ssh and returns the
 * remaining keys. Only files inside ~/.ssh may be deleted; if the deleted key
 * was the active one the selection is cleared.
 */
export function deleteSshKey(privateKeyPath: string): SshKeyInfo[] {
    const dir = sshDir()
    const resolved = path.resolve(privateKeyPath.trim())
    if (!resolved.startsWith(dir + path.sep)) throw new Error('Only keys inside ~/.ssh can be deleted')
    const pub = resolved.endsWith('.pub') ? resolved : `${resolved}.pub`
    const priv = pub.replace(/\.pub$/, '')
    if (!fs.existsSync(priv) && !fs.existsSync(pub)) throw new Error(`Key "${path.basename(priv)}" not found`)
    fs.rmSync(priv, { force: true })
    fs.rmSync(pub, { force: true })
    const cfg = getAuthConfig()
    if (cfg.sshKeyPath && path.resolve(cfg.sshKeyPath) === priv) {
        saveAuthConfig({ ...cfg, sshKeyPath: '' })
        log('info', 'auth', 'active SSH key deleted — selection cleared')
    }
    log('info', 'auth', `deleted SSH key ${path.basename(priv)}`)
    return listSshKeys()
}

export function generateSshKey(name: string, comment: string, passphrase?: string): SshKeyInfo {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Enter a key file name')
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleanName)) throw new Error('Invalid key file name')
    const dir = sshDir()
    fs.mkdirSync(dir, { recursive: true })
    const privatePath = path.join(dir, cleanName)
    if (fs.existsSync(privatePath)) throw new Error(`Key "${cleanName}" already exists in ~/.ssh`)
    const args = ['-t', 'ed25519', '-f', privatePath, '-C', comment.trim() || 'open-git', '-N', typeof passphrase === 'string' && passphrase ? passphrase : '']
    execFileSync('ssh-keygen', args, { timeout: 30_000, encoding: 'utf8' })
    log('info', 'auth', `generated SSH key ${cleanName}`)
    return {
        name: `${cleanName}.pub`,
        publicKeyPath: `${privatePath}.pub`,
        privateKeyPath: privatePath,
        publicKey: fs.readFileSync(`${privatePath}.pub`, 'utf8').trim(),
        fingerprint: fingerprintOf(`${privatePath}.pub`),
        active: false,
    }
}

interface ExecOutcome {
    code: number
    stdout: string
    stderr: string
}

function execAsync(cmd: string, args: string[], timeoutMs: number): Promise<ExecOutcome> {
    return new Promise(resolve => {
        execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (err) {
                const code = typeof err.code === 'number' ? err.code : 1
                resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) })
            } else {
                resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
            }
        })
    })
}

export async function testSshKey(privateKeyPath: string): Promise<SshTestResult> {
    const key = privateKeyPath.trim()
    if (!key || !fs.existsSync(key)) return { ok: false, message: 'Select a key first (private key not found)' }
    const { code, stderr } = await execAsync(
        'ssh',
        ['-T', 'git@github.com', '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes'],
        20_000
    )
    // `ssh -T git@github.com` exits 1 even on success (no shell access), the message is what matters
    const text = stderr.trim()
    const match = text.match(/Hi ([^!]+)!/)
    if (match) return { ok: true, message: `Authenticated as ${match[1]}` }
    if (code === 0) return { ok: true, message: text || 'Connected' }
    return { ok: false, message: text || `ssh exited with code ${code}` }
}

export async function verifyGithubToken(token: string): Promise<GithubUser> {
    const clean = token.trim()
    if (!clean) throw new Error('Enter a token first')
    const res = await fetch(GITHUB_API_USER, {
        headers: { authorization: `Bearer ${clean}`, 'user-agent': 'open-git', accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
        throw new Error(res.status === 401 ? 'Invalid token (401 Unauthorized)' : `GitHub request failed (HTTP ${res.status})`)
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!json || typeof json.login !== 'string') throw new Error('Unexpected response from GitHub')
    return {
        login: json.login,
        name: typeof json.name === 'string' ? json.name : '',
        avatarUrl: typeof json.avatar_url === 'string' ? json.avatar_url : '',
        htmlUrl: typeof json.html_url === 'string' ? json.html_url : '',
        bio: typeof json.bio === 'string' ? json.bio : '',
        publicRepos: typeof json.public_repos === 'number' ? json.public_repos : 0,
        followers: typeof json.followers === 'number' ? json.followers : 0,
    }
}

export async function githubStatus(): Promise<GithubUser | null> {
    const token = getAuthConfig().githubToken.trim()
    if (!token) return null
    try {
        return await verifyGithubToken(token)
    } catch {
        return null
    }
}

export function openSshDir(): Promise<string> {
    return shell.openPath(sshDir())
}

export function openGithubTokenPage(): Promise<void> {
    void shell.openExternal(GITHUB_TOKEN_URL)
    return Promise.resolve()
}

/**
 * Environment injected into every git instance so pushes/pulls use the
 * credentials configured in the Authentication settings (global scope).
 * - SSH remotes: GIT_SSH_COMMAND pins the selected private key
 * - HTTPS github.com remotes: config extraheader carries the token as basic auth
 */
export function authGitEnv(): Record<string, string> {
    const cfg = getAuthConfig()
    const env: Record<string, string> = {}
    if (cfg.sshKeyPath && fs.existsSync(cfg.sshKeyPath)) {
        env.GIT_SSH_COMMAND = `ssh -i "${cfg.sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
    }
    const token = cfg.githubToken.trim()
    if (token) {
        const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
        env.GIT_CONFIG_COUNT = '1'
        env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
        env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`
    }
    return env
}
