// Renderer-side view of the OpenCode Zen Go config that lives in the main process.
// `token` is prefilled for editing; the persisted copy is used by main when it
// actually calls the model API.
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
            /* main not ready / unset — ignore */
        }
    }

    async function save(cfg: { token: string; modelId: string }) {
        await window.api.ai.saveConfig(cfg)
        token.value = cfg.token
        modelId.value = cfg.modelId
    }

    return { token, modelId, configured, load, save }
})