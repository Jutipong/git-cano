import type { AiConfig } from '@shared/types'

export const useAiStore = defineStore('ai', () => {
    const config = ref<AiConfig>({
        provider: 'opencode-go',
        opencodeGo: { token: '', modelId: '', models: [] },
        openrouter: { token: '', modelId: '', models: [] },
        commitInstructions: '',
    })
    const provider = computed(() => config.value.provider)
    const activeConfig = computed(() => (provider.value === 'opencode-go' ? config.value.opencodeGo : config.value.openrouter))
    const token = computed(() => activeConfig.value.token)
    const modelId = computed(() => activeConfig.value.modelId)
    const configured = computed(() => provider.value !== 'none' && token.value.trim() !== '' && modelId.value.trim() !== '')

    async function load() {
        try {
            const cfg = await window.api.ai.getConfig()
            config.value = cfg
        } catch {}
    }

    async function save(cfg: AiConfig) {
        await window.api.ai.saveConfig(cfg)
        config.value = cfg
    }

    return { config, provider, token, modelId, configured, load, save }
})
