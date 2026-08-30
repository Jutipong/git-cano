<script setup lang="ts">
    import Moon from '~icons/lucide/moon'
    import Sun from '~icons/lucide/sun'

    import type { ToastKind } from '../stores/uiTransient'
    import type { AiConfig, AiProvider, AiProviderConfig, GoModel } from '@shared/types'
    import { useUiStore, FONT_SIZE_OPTIONS, REFRESH_INTERVAL_OPTIONS, ZOOM_OPTIONS, type ThemeOption } from '../stores/ui'
    import { confirmDialog } from '../utils/confirm'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()

    const TABS = [
        { key: 'general', label: 'General' },
        { key: 'ai', label: 'AI' },
    ] as const
    const tab = ref<'general' | 'ai'>('general')

    const REFRESH_OPTIONS = REFRESH_INTERVAL_OPTIONS.map(value => ({ value, label: `${value} min` }))
    const FONT_OPTIONS = FONT_SIZE_OPTIONS.map(value => ({ value, label: `${value}px` }))
    const DISPLAY_ZOOM_OPTIONS = ZOOM_OPTIONS.map(value => ({ value, label: `${value}%` }))

    const themeIcon = (option: ThemeOption) => (option.icon === 'sun' ? Sun : Moon)

    const ai = useAiStore()
    const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
        { value: 'opencode-go', label: 'OpenCode Go' },
        { value: 'openrouter', label: 'OpenRouter' },
    ]
    const selectedProvider = ref<AiProvider>('opencode-go')
    const providerDrafts = reactive<Record<AiProvider, AiProviderConfig>>({
        'opencode-go': { token: '', modelId: '', models: [] },
        openrouter: { token: '', modelId: '', models: [] },
    })
    const aiToken = computed({
        get: () => providerDrafts[selectedProvider.value].token,
        set: value => {
            const draft = providerDrafts[selectedProvider.value]
            if (draft.token === value) return
            draft.token = value
            draft.modelId = ''
            draft.models = []
            modelOptions.value = []
            connectResult.value = null
            aiTestResult.value = null
        },
    })
    const aiModel = computed({
        get: () => providerDrafts[selectedProvider.value].modelId,
        set: value => (providerDrafts[selectedProvider.value].modelId = value),
    })
    const aiTesting = ref(false)
    const aiTestResult = ref<{ ok: boolean; message: string } | null>(null)
    const connecting = ref(false)
    const connectResult = ref<{ ok: boolean; message: string } | null>(null)
    const modelOptions = ref<GoModel[]>([])
    const modelSelectOptions = computed(() => {
        const current = aiModel.value.trim()
        if (!current) return modelOptions.value
        const known = modelOptions.value.some(m => m.id === current)
        return known ? modelOptions.value : [{ id: current, name: current }, ...modelOptions.value]
    })

    let aiLoaded = false
    async function loadAiTab() {
        if (aiLoaded) return
        aiLoaded = true
        try {
            await ai.load()
            selectedProvider.value = ai.config.provider
            Object.assign(providerDrafts['opencode-go'], ai.config.opencodeGo)
            Object.assign(providerDrafts.openrouter, ai.config.openrouter)
            modelOptions.value = [...providerDrafts[selectedProvider.value].models]
        } catch {
        }
    }

    watch(tab, async current => {
        if (current === 'ai') await loadAiTab()
    })

    watch(selectedProvider, () => {
        modelOptions.value = [...providerDrafts[selectedProvider.value].models]
        connectResult.value = null
        aiTestResult.value = null
    })

    function currentConfig(): AiConfig {
        return {
            provider: selectedProvider.value,
            opencodeGo: {
                ...providerDrafts['opencode-go'],
                models: providerDrafts['opencode-go'].models.map(model => ({ ...model })),
            },
            openrouter: {
                ...providerDrafts.openrouter,
                models: providerDrafts.openrouter.models.map(model => ({ ...model })),
            },
        }
    }

    async function connectProvider() {
        if (!aiToken.value.trim() || connecting.value) return
        connecting.value = true
        connectResult.value = null
        try {
            const models = await window.api.ai.listModels(selectedProvider.value, aiToken.value.trim())
            if (models.length === 0) {
                connectResult.value = { ok: false, message: 'Provider returned no models' }
            } else {
                const seen = new Set<string>()
                const uniqueModels = models.filter(m => {
                    if (seen.has(m.id)) return false
                    seen.add(m.id)
                    return true
                })
                providerDrafts[selectedProvider.value].models = uniqueModels
                modelOptions.value = uniqueModels
                await ai.save(currentConfig())
                connectResult.value = { ok: true, message: `Loaded — ${uniqueModels.length} models available` }
            }
        } catch (error) {
            connectResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            connecting.value = false
        }
    }

    async function testAi() {
        if (!aiToken.value.trim() || !aiModel.value.trim()) return
        aiTesting.value = true
        aiTestResult.value = null
        try {
            const result = await window.api.ai.test(selectedProvider.value, aiToken.value.trim(), aiModel.value.trim())
            aiTestResult.value = result
            if (result.ok) await ai.save(currentConfig())
        } catch (error) {
            aiTestResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            aiTesting.value = false
        }
    }

    async function saveAi() {
        try {
            await ai.save(currentConfig())
            notify('AI settings saved', 'success')
            emit('close')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function resetGeneral() {
        const ok = await confirmDialog({
            message: 'Reset Appearance and Refresh settings to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetGeneral()
        notify('Settings reset to defaults', 'success')
    }

    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') emit('close')
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal tools-modal">
            <div class="rebase-modal-header">
                <strong class="tools-modal-title">
                    <i-lucide-settings2
                        width="15"
                        height="15" />
                    Settings
                </strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    @click="emit('close')">
                    <i-lucide-x
                        width="16"
                        height="16" />
                </button>
            </div>
            <div class="tools-tabs">
                <button
                    v-for="tabItem in TABS"
                    :key="tabItem.key"
                    class="graph-filter"
                    :class="{ active: tab === tabItem.key }"
                    @click="tab = tabItem.key">
                    <i-lucide-sliders-horizontal
                        v-if="tabItem.key === 'general'"
                        width="13"
                        height="13" />
                    <i-lucide-sparkles
                        v-else
                        width="13"
                        height="13" />
                    {{ tabItem.label }}
                </button>
            </div>
            <div class="tools-body general-body">
                <template v-if="tab === 'general'">
                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-palette
                                width="13"
                                height="13" />
                            Appearance
                        </strong>
                        <span class="setting-label">Theme</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in ui.themeOptions"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.theme === option.value }"
                                @click="ui.setTheme(option.value)">
                                <component
                                    :is="themeIcon(option)"
                                    width="13"
                                    height="13" />
                                {{ option.label }}
                            </button>
                        </div>
                        <span class="setting-label">Font size</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in FONT_OPTIONS"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.fontSize === option.value }"
                                @click="ui.fontSize = option.value">
                                {{ option.label }}
                            </button>
                        </div>
                        <span class="setting-label">Zoom</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in DISPLAY_ZOOM_OPTIONS"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.zoom === option.value }"
                                @click="ui.zoom = option.value">
                                {{ option.label }}
                            </button>
                        </div>
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-refresh-cw
                                width="13"
                                height="13" />
                            Refresh
                        </strong>
                        <span class="setting-label">Auto-refresh interval</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in REFRESH_OPTIONS"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.refreshInterval === option.value }"
                                @click="ui.refreshInterval = option.value">
                                {{ option.label }}
                            </button>
                        </div>
                    </div>

                    <div class="tools-actions tools-reset-row">
                        <span class="spacer" />
                        <button
                            class="btn danger small"
                            title="Restore Appearance and Refresh settings to defaults"
                            @click="resetGeneral()">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                            Reset to defaults
                        </button>
                    </div>
                </template>

                <template v-else>
                    <div class="tools-section ai-provider-section">
                        <strong class="tools-section-title">
                            <i-lucide-sparkles
                                width="13"
                                height="13" />
                            AI Provider
                        </strong>
                        <label class="ai-field">
                            <span>Provider</span>
                            <div class="ai-field-select">
                                <select v-model="selectedProvider">
                                    <option
                                        v-for="option in PROVIDER_OPTIONS"
                                        :key="option.value"
                                        :value="option.value">
                                        {{ option.label }}
                                    </option>
                                </select>
                                <i-lucide-chevron-down
                                    class="ai-select-caret"
                                    width="14"
                                    height="14" />
                            </div>
                        </label>
                    </div>

                    <div
                        v-if="selectedProvider === 'opencode-go'"
                        class="tools-section">
                        <strong class="tools-section-title">OpenCode Go</strong>
                        <p class="tools-section-hint">
                            Generate commit messages from your staged changes. Get a token at
                            <a
                                href="https://opencode.ai/auth"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="ai-link">opencode.ai/auth</a>.
                        </p>
                        <label class="ai-field">
                            <span>Token</span>
                            <div class="ai-token-row">
                                <input
                                    v-model="aiToken"
                                    type="password"
                                    placeholder="opencode token"
                                    autocomplete="off" />
                                <button
                                    class="btn success small"
                                    :disabled="!aiToken.trim() || connecting"
                                    @click="connectProvider()">
                                    <i-lucide-loader-circle
                                        v-if="connecting"
                                        class="spinning"
                                        width="13"
                                        height="13" />
                                    <i-lucide-download
                                        v-else
                                        width="13"
                                        height="13" />
                                    {{ connecting ? 'Getting models…' : 'Get models' }}
                                </button>
                            </div>
                            <span
                                v-if="connectResult"
                                class="ai-test-result"
                                :class="connectResult.ok ? 'ok' : 'err'">{{ connectResult.message }}</span>
                        </label>
                        <label class="ai-field">
                            <span>Model ID</span>
                            <div class="ai-field-select">
                                <select v-model="aiModel">
                                    <option
                                        v-for="m in modelSelectOptions"
                                        :key="m.id"
                                        :value="m.id">
                                        {{ m.name }}
                                    </option>
                                </select>
                                <i-lucide-chevron-down
                                    class="ai-select-caret"
                                    width="14"
                                    height="14" />
                            </div>
                        </label>
                    </div>

                    <div
                        v-else
                        class="tools-section">
                        <strong class="tools-section-title">OpenRouter</strong>
                        <p class="tools-section-hint">
                            Use any model available on OpenRouter. Create an API key at
                            <a
                                href="https://openrouter.ai/keys"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="ai-link">openrouter.ai/keys</a>.
                        </p>
                        <label class="ai-field">
                            <span>API key</span>
                            <div class="ai-token-row">
                                <input
                                    v-model="aiToken"
                                    type="password"
                                    placeholder="sk-or-v1-..."
                                    autocomplete="off" />
                                <button
                                    class="btn success small"
                                    :disabled="!aiToken.trim() || connecting"
                                    @click="connectProvider()">
                                    <i-lucide-loader-circle
                                        v-if="connecting"
                                        class="spinning"
                                        width="13"
                                        height="13" />
                                    <i-lucide-download
                                        v-else
                                        width="13"
                                        height="13" />
                                    {{ connecting ? 'Getting models…' : 'Get models' }}
                                </button>
                            </div>
                            <span
                                v-if="connectResult"
                                class="ai-test-result"
                                :class="connectResult.ok ? 'ok' : 'err'">{{ connectResult.message }}</span>
                        </label>
                        <label class="ai-field">
                            <span>Model</span>
                            <div class="ai-field-select">
                                <select v-model="aiModel">
                                    <option
                                        v-for="m in modelSelectOptions"
                                        :key="m.id"
                                        :value="m.id">
                                        {{ m.name }}
                                    </option>
                                </select>
                                <i-lucide-chevron-down
                                    class="ai-select-caret"
                                    width="14"
                                    height="14" />
                            </div>
                        </label>
                    </div>
                    <div class="tools-actions">
                        <button
                            class="btn success small"
                            :disabled="!aiToken.trim() || !aiModel.trim() || aiTesting"
                            @click="testAi()">
                            <i-lucide-flask-conical
                                v-if="!aiTesting"
                                width="13"
                                height="13" />
                            <i-lucide-loader-circle
                                v-else
                                class="spinning"
                                width="13"
                                height="13" />
                            {{ aiTesting ? 'Testing…' : 'Test connect' }}
                        </button>
                        <span
                            v-if="aiTestResult"
                            class="ai-test-result"
                            :class="aiTestResult.ok ? 'ok' : 'err'">{{ aiTestResult.message }}</span>
                        <span class="spacer" />
                        <button
                            class="btn small"
                            :disabled="aiTesting"
                            @click="emit('close')">
                            <i-lucide-x
                                width="13"
                                height="13" />
                            Close
                        </button>
                        <button
                            class="btn primary small"
                            :disabled="aiTesting"
                            @click="saveAi()">
                            <i-lucide-save
                                width="13"
                                height="13" />
                            Save
                        </button>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>
