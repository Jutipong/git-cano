import type { AuthConfig, SshKeyInfo } from '@shared/types'

export const useAuthStore = defineStore('auth', () => {
    const config = ref<AuthConfig>({ githubToken: '', sshKeyPath: '' })
    const keys = ref<SshKeyInfo[]>([])

    async function load() {
        try {
            config.value = await window.api.auth.getConfig()
        } catch {}
    }

    async function save(cfg: AuthConfig) {
        config.value = await window.api.auth.saveConfig(cfg)
    }

    async function refreshKeys() {
        try {
            keys.value = await window.api.auth.sshList()
        } catch {}
    }

    return { config, keys, load, save, refreshKeys }
})
