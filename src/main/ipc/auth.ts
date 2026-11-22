import {
    deleteSshKey,
    generateSshKey,
    getAuthConfig,
    githubStatus,
    listSshKeys,
    openGithubTokenPage,
    openSshDir,
    refreshGithubProfile,
    saveAuthConfig,
    testSshKey,
    verifyGithubToken,
} from '../auth'
import { sshTestHost } from '../git'
import { handle, handleSensitive } from './core'

/** Auth slice IPC: GitHub token, SSH keys and credential config (never logged). */

export function registerAuthIpc(): void {
    handleSensitive('auth:getConfig', () => getAuthConfig())
    handleSensitive('auth:saveConfig', (_cfg: unknown) => saveAuthConfig(_cfg as never))
    handleSensitive('auth:ssh:list', () => listSshKeys())
    handleSensitive('auth:ssh:generate', (name: string, comment: string, passphrase?: string) =>
        generateSshKey(String(name), String(comment ?? ''), typeof passphrase === 'string' ? passphrase : undefined)
    )
    handleSensitive('auth:ssh:test', (keyPath: string) => sshTestHost().then(host => testSshKey(String(keyPath), host)))
    handleSensitive('auth:ssh:delete', (keyPath: string) => deleteSshKey(String(keyPath)))
    handle('auth:ssh:openDir', () => openSshDir())
    handleSensitive('auth:github:status', () => githubStatus())
    handleSensitive('auth:github:refresh', () => refreshGithubProfile())
    handleSensitive('auth:github:verify', (token: string) => verifyGithubToken(String(token)))
    handleSensitive('auth:github:openTokenPage', () => openGithubTokenPage())
}
