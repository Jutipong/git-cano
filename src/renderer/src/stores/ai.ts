export const useAiStore = defineStore('ai', () => {
    const token = ref('')
    const modelId = ref('')
    const configured = computed(() => token.value.trim() !== '' && modelId.value.trim() !== '')

    async function load() {
        try {
            const cfg = await window.api.ai.getConfig()
            token.value = cfg.token
            modelId.value = cfg.modelId
        } catch {
        }
    }

    async function save(cfg: { token: string; modelId: string }) {
        await window.api.ai.saveConfig(cfg)
        token.value = cfg.token
        modelId.value = cfg.modelId
    }

    return { token, modelId, configured, load, save }
})