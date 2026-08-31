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
        try {
            githubUser.value = await window.api.auth.githubStatus()
        } catch {
            githubUser.value = null
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

    /** True when the given commit author name refers to the signed-in GitHub user. */
    function isGithubUser(author: string): boolean {
        const u = githubUser.value
        if (!u) return false
        const name = author.trim().toLowerCase()
        return (!!u.login && name === u.login.toLowerCase()) || (!!u.name && name === u.name.toLowerCase())
    }

    return { config, keys, githubUser, load, save, refreshKeys, refreshGithubUser, isGithubUser }
})
