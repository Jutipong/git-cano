import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { AuthConfig, GithubUser, SshKeyInfo } from '@shared/types'

export const useAuthStore = defineStore('auth', () => {
    const config = ref<AuthConfig>({ githubToken: '', sshKeyPath: '' })
    const keys = ref<SshKeyInfo[]>([])
    const githubUser = ref<GithubUser | null>(null)

    async function load() {
        try {
            config.value = await window.api.auth.getConfig()
        } catch {}
        await refreshGithubUser()
    }

    async function refreshGithubUser() {
        // 1) show the cached profile immediately (works offline)
        try {
            githubUser.value = await window.api.auth.githubStatus()
        } catch {
            githubUser.value = null
        }
        // 2) background refresh when online — updates the UI and persists a fresh cache
        if (githubUser.value) {
            window.api.auth
                .githubRefresh()
                .then(user => {
                    if (user) githubUser.value = user
                })
                .catch(() => {})
        }
    }

    async function save(cfg: AuthConfig) {
        config.value = await window.api.auth.saveConfig(cfg)
        await refreshGithubUser()
    }

    async function refreshKeys() {
        try {
            keys.value = await window.api.auth.sshList()
        } catch {}
    }

    /**
     * True when the given commit author refers to the signed-in GitHub user. Matched by (in order): exact login/name, GitHub email, GitHub
     * noreply email, then a loose name comparison (dots/dashes/underscores/spaces stripped, one side a prefix of the other — "Jutipong" ~
     * "Jutipong.Dev").
     */
    function isGithubUser(author: string, email?: string): boolean {
        const u = githubUser.value
        if (!u) return false
        const name = author.trim().toLowerCase()
        if ((!!u.login && name === u.login.toLowerCase()) || (!!u.name && name === u.name.toLowerCase())) {
            return true
        }
        const mail = (email ?? '').trim().toLowerCase()
        if (mail) {
            if (u.email && mail === u.email.toLowerCase()) return true
            const noreply = mail.match(/^\d+\+([a-z0-9-]+)@users\.noreply\.github\.com$/)
            if (noreply && noreply[1] === u.login.toLowerCase()) return true
        }
        const squash = (s: string) => s.replace(/[.\-_\s]/g, '')
        const a = squash(name)
        const b = squash(u.login.toLowerCase())
        return a.length > 0 && b.length > 0 && (b.startsWith(a) || a.startsWith(b))
    }

    return { config, keys, githubUser, load, save, refreshKeys, refreshGithubUser, isGithubUser }
})
