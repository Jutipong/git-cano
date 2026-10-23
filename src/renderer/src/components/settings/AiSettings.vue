<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, inject, onMounted, reactive, ref, watch } from 'vue'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideFlaskConical from '~icons/lucide/flask-conical'
    import ILucideSave from '~icons/lucide/save'
    import ILucideSparkles from '~icons/lucide/sparkles'

    import { useAiStore } from '../../stores/ai'
    import { useUiStore } from '../../stores/ui'
    import ThinkSpinner from '../ThinkSpinner.vue'

    import type { ToastKind } from '../../stores/uiTransient'
    import type { AiConfig, AiProvider, AiProviderConfig, GoModel } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const ui = useUiStore()

    const ai = useAiStore()
    const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
        { value: 'none', label: 'None' },
        { value: 'opencode-go', label: 'OpenCode Go' },
        { value: 'openrouter', label: 'OpenRouter' },
    ]
    const selectedProvider = ref<AiProvider>('opencode-go')
    const commitInstructions = ref('')
    const providerDrafts = reactive<Record<Exclude<AiProvider, 'none'>, AiProviderConfig>>({
        'opencode-go': { token: '', modelId: '', models: [] },
        openrouter: { token: '', modelId: '', models: [] },
    })
    const currentDraft = computed(() => (selectedProvider.value === 'none' ? null : providerDrafts[selectedProvider.value]))
    const modelQuery = ref('')
    const modelDropdownOpen = ref(false)
    const modelInput = ref<HTMLInputElement | null>(null)
    const aiToken = computed({
        get: () => currentDraft.value?.token ?? '',
        set: value => {
            const draft = currentDraft.value
            if (!draft || draft.token === value) return
            draft.token = value
            draft.modelId = ''
            draft.models = []
            modelQuery.value = ''
            modelOptions.value = []
            connectResult.value = null
            aiTestResult.value = null
        },
    })
    const aiModel = computed({
        get: () => currentDraft.value?.modelId ?? '',
        set: value => {
            if (currentDraft.value) currentDraft.value.modelId = value
        },
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
    const filteredModelOptions = computed(() => {
        const query = modelQuery.value.trim().toLowerCase()
        return modelSelectOptions.value.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(query))
    })
    const modelDropdownStyle = computed(() => {
        const rect = modelInput.value?.getBoundingClientRect()
        if (!rect) return {}
        const maxHeight = 360
        const openAbove = window.innerHeight - rect.bottom < maxHeight + 12 && rect.top > maxHeight / 2
        const availableHeight = openAbove ? rect.top - 12 : window.innerHeight - rect.bottom - 12
        const height = Math.max(64, Math.min(maxHeight, availableHeight))
        return {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            maxHeight: `${height}px`,
            ...(openAbove ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` }),
        }
    })

    function onModelInput(event: Event) {
        const input = event.target
        if (!(input instanceof HTMLInputElement)) return
        modelQuery.value = input.value
        if (input.value !== aiModel.value) aiModel.value = ''
        modelDropdownOpen.value = true
    }

    function selectModel(model: GoModel) {
        aiModel.value = model.id
        modelQuery.value = model.id
        modelDropdownOpen.value = false
    }

    function closeModelDropdown() {
        window.setTimeout(() => {
            modelDropdownOpen.value = false
        }, 120)
    }

    let aiLoaded = false
    async function loadAiTab() {
        if (aiLoaded) return
        aiLoaded = true
        try {
            await ai.load()
            selectedProvider.value = ai.config.provider
            commitInstructions.value = ai.config.commitInstructions ?? ''
            Object.assign(providerDrafts['opencode-go'], ai.config.opencodeGo)
            Object.assign(providerDrafts.openrouter, ai.config.openrouter)
            modelOptions.value = selectedProvider.value === 'none' ? [] : [...providerDrafts[selectedProvider.value].models]
            modelQuery.value = aiModel.value
        } catch {}
    }

    watch(selectedProvider, () => {
        modelOptions.value = selectedProvider.value === 'none' ? [] : [...providerDrafts[selectedProvider.value].models]
        modelQuery.value = aiModel.value
        modelDropdownOpen.value = false
        connectResult.value = null
        aiTestResult.value = null
    })

    function currentConfig(): AiConfig {
        return {
            provider: selectedProvider.value,
            commitInstructions: commitInstructions.value.trim().slice(0, 2000),
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
        if (selectedProvider.value === 'none' || !aiToken.value.trim() || connecting.value) return
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
            connectResult.value = { ok: false, message: errorMessage(error) }
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
            if (result.ok) {
                aiTestResult.value = result
                await ai.save(currentConfig())
            } else {
                notify(result.message, 'error')
            }
        } catch (error) {
            notify(errorMessage(error), 'error')
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
            notify(errorMessage(error), 'error')
        }
    }

    onMounted(loadAiTab)
</script>

<template>
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
                class="ai-link"
                >opencode.ai/auth</a
            >.
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
                    class="btn small"
                    :disabled="!aiToken.trim() || connecting"
                    @click="connectProvider()">
                    <ThinkSpinner
                        v-if="connecting"
                        compact />
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
                :class="connectResult.ok ? 'ok' : 'err'"
                >{{ connectResult.message }}</span
            >
        </label>
        <label class="ai-field">
            <span>Model ID</span>
            <p class="tools-section-hint ai-model-source">
                {{ modelOptions.length }} models from the OpenCode Go catalog — press Get models to refresh.
            </p>
            <div class="ai-model-picker">
                <input
                    ref="modelInput"
                    :value="modelQuery"
                    type="text"
                    placeholder="Search models"
                    autocomplete="off"
                    @input="onModelInput"
                    @focus="modelDropdownOpen = true"
                    @blur="closeModelDropdown"
                    @keydown.escape.stop="modelDropdownOpen = false" />
                <div
                    v-if="modelDropdownOpen"
                    class="ai-model-options"
                    :style="modelDropdownStyle">
                    <button
                        v-for="m in filteredModelOptions"
                        :key="m.id"
                        type="button"
                        class="ai-model-option"
                        @mousedown.prevent="selectModel(m)">
                        <span class="ai-model-name"
                            >{{ m.name
                            }}<em
                                v-if="m.free"
                                class="ai-model-free"
                                >Free</em
                            ></span
                        >
                        <small>{{ m.id }}</small>
                    </button>
                    <span
                        v-if="filteredModelOptions.length === 0"
                        class="ai-model-empty"
                        >No models found</span
                    >
                </div>
                <i-lucide-chevron-down
                    class="ai-select-caret"
                    width="14"
                    height="14" />
            </div>
        </label>
    </div>

    <div
        v-else-if="selectedProvider === 'openrouter'"
        class="tools-section">
        <strong class="tools-section-title">OpenRouter</strong>
        <p class="tools-section-hint">
            Use any model available on OpenRouter. Create an API key at
            <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                class="ai-link"
                >openrouter.ai/keys</a
            >.
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
                    class="btn small"
                    :disabled="!aiToken.trim() || connecting"
                    @click="connectProvider()">
                    <ThinkSpinner
                        v-if="connecting"
                        compact />
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
                :class="connectResult.ok ? 'ok' : 'err'"
                >{{ connectResult.message }}</span
            >
        </label>
        <label class="ai-field">
            <span>Model</span>
            <p class="tools-section-hint ai-model-source">
                {{ modelOptions.length }} models from the OpenRouter catalog — press Get models to refresh.
            </p>
            <div class="ai-model-picker">
                <input
                    ref="modelInput"
                    :value="modelQuery"
                    type="text"
                    placeholder="Search models"
                    autocomplete="off"
                    @input="onModelInput"
                    @focus="modelDropdownOpen = true"
                    @blur="closeModelDropdown"
                    @keydown.escape.stop="modelDropdownOpen = false" />
                <div
                    v-if="modelDropdownOpen"
                    class="ai-model-options"
                    :style="modelDropdownStyle">
                    <button
                        v-for="m in filteredModelOptions"
                        :key="m.id"
                        type="button"
                        class="ai-model-option"
                        @mousedown.prevent="selectModel(m)">
                        <span class="ai-model-name"
                            >{{ m.name
                            }}<em
                                v-if="m.free"
                                class="ai-model-free"
                                >Free</em
                            ></span
                        >
                        <small>{{ m.id }}</small>
                    </button>
                    <span
                        v-if="filteredModelOptions.length === 0"
                        class="ai-model-empty"
                        >No models found</span
                    >
                </div>
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
        <strong class="tools-section-title">No AI</strong>
        <p class="tools-section-hint">AI features are disabled. Select a provider above to enable commit-message generation.</p>
    </div>
    <div
        v-if="selectedProvider !== 'none'"
        class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-sparkles
                width="13"
                height="13" />
            Custom instructions
        </strong>
        <label class="ai-field">
            <span>Extra rules for generated commit messages</span>
            <textarea
                v-model="commitInstructions"
                rows="3"
                maxlength="2000"
                placeholder="e.g. Always include a scope like (api) or (ui). Use Thai for the description."
                autocomplete="off" />
        </label>
        <p class="tools-section-hint">Appended to the built-in style rules on every generation.</p>
    </div>
    <div class="tools-section">
        <strong class="tools-section-title">Commit message</strong>
        <span
            id="format-before-label"
            class="setting-label"
            >Format before generating</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="format-before-label">
            <button
                type="button"
                class="setting-chip"
                :class="{ active: ui.formatBeforeGenerate }"
                :aria-pressed="ui.formatBeforeGenerate"
                @click="ui.formatBeforeGenerate = !ui.formatBeforeGenerate">
                <i-lucide-check
                    v-if="ui.formatBeforeGenerate"
                    width="13"
                    height="13" />
                {{ ui.formatBeforeGenerate ? 'On' : 'Off' }}
            </button>
        </div>
        <p class="tools-section-hint">
            When enabled, the repository's format command runs first if it has an
            <code>.oxfmtrc.json</code>; otherwise the message is generated as-is. Formatting worktree files cannot affect a staged-only
            message, so it applies to the Auto Commit modes and is skipped for Generate Only.
        </p>
    </div>
    <div class="tools-actions">
        <template v-if="selectedProvider !== 'none'">
            <button
                class="btn success small"
                :disabled="!aiToken.trim() || !aiModel.trim() || aiTesting"
                @click="testAi()">
                <i-lucide-flask-conical
                    v-if="!aiTesting"
                    width="13"
                    height="13" />
                <ThinkSpinner
                    v-else
                    compact />
                {{ aiTesting ? 'Testing…' : 'Test connect' }}
            </button>
            <span
                v-if="aiTestResult?.ok"
                class="ai-test-result ok"
                >{{ aiTestResult.message }}</span
            >
        </template>
        <span class="spacer" />
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
