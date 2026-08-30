<script setup lang="ts">
    import Moon from '~icons/lucide/moon'
    import Sun from '~icons/lucide/sun'

    import type { ToastKind } from '../stores/uiTransient'
    import type { GoModel } from '@shared/types'
    import { useUiStore, type ThemeOption } from '../stores/ui'
    import { confirmDialog } from '../utils/confirm'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()

    const tab = ref<'general' | 'ai'>('general')
    const appVersion = ref('')

    const REFRESH_OPTIONS = [
        { value: 0, label: 'Off' },
        { value: 30, label: '30s' },
        { value: 60, label: '1 min' },
        { value: 300, label: '5 min' },
    ]

    const themeIcon = (option: ThemeOption) => (option.icon === 'sun' ? Sun : Moon)

    const ai = useAiStore()
    const aiToken = ref('')
    const aiModel = ref('')
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
            aiToken.value = ai.token
            aiModel.value = ai.modelId
        } catch {
        }
    }

    watch(tab, async current => {
        if (current === 'ai') await loadAiTab()
    })

    async function connectProvider() {
        if (!aiToken.value.trim() || connecting.value) return
        connecting.value = true
        connectResult.value = null
        try {
            const models = await window.api.ai.listModels()
            if (models.length === 0) {
                connectResult.value = { ok: false, message: 'Provider returned no models' }
            } else {
                const seen = new Set<string>()
                modelOptions.value = models.filter(m => {
                    if (seen.has(m.id)) return false
                    seen.add(m.id)
                    return true
                })
                connectResult.value = { ok: true, message: `Connected — ${models.length} models available` }
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
            const result = await window.api.ai.test(aiToken.value.trim(), aiModel.value.trim())
            aiTestResult.value = result
            if (result.ok) await ai.save({ token: aiToken.value.trim(), modelId: aiModel.value.trim() })
        } catch (error) {
            aiTestResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            aiTesting.value = false
        }
    }

    async function saveAi() {
        try {
            await ai.save({ token: aiToken.value.trim(), modelId: aiModel.value.trim() })
            notify('AI settings saved', 'success')
            emit('close')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function resetGeneral() {
        const ok = await confirmDialog({
            message: 'Reset Appearance, Diff & Files, and Refresh settings to defaults?',
            confirmLabel: 'Reset',
        })
        if (!ok) return
        ui.resetGeneral()
        notify('Settings reset to defaults', 'success')
    }

    onMounted(async () => {
        window.addEventListener('keydown', onKeydown)
        appVersion.value = await window.api.appVersion().catch(() => '')
    })
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') emit('close')
    }
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="rebase-modal tools-modal">
            <div class="rebase-modal-header">
                <strong>Settings</strong>
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
                    v-for="name in ['general', 'ai'] as const"
                    :key="name"
                    class="graph-filter"
                    :class="{ active: tab === name }"
                    @click="tab = name">
                    {{ name }}
                </button>
            </div>
            <div class="tools-body general-body">
                <template v-if="tab === 'general'">
                    <div class="tools-section">
                        <strong class="tools-section-title">Appearance</strong>
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
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">Diff & Files</strong>
                        <span class="setting-label">Default diff view</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="mode in ['split', 'inline'] as const"
                                :key="mode"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.diffViewMode === mode }"
                                @click="ui.diffViewMode = mode">
                                {{ mode === 'split' ? 'Split' : 'Inline' }}
                            </button>
                        </div>
                        <label class="setting-toggle">
                            <input
                                v-model="ui.showEntireFile"
                                type="checkbox" />
                            Show entire file in diff
                        </label>
                        <span class="setting-label">Files panel layout</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="mode in ['tree', 'flat'] as const"
                                :key="mode"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.fileViewMode === mode }"
                                @click="ui.fileViewMode = mode">
                                {{ mode === 'tree' ? 'Tree' : 'Flat' }}
                            </button>
                        </div>
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">Refresh</strong>
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

                    <div class="tools-section">
                        <strong class="tools-section-title">About</strong>
                        <p class="tools-hint">
                            Open Git {{ appVersion || '…' }} — a lightweight Git GUI.
                            Commit-message AI is powered by
                            <a
                                href="https://opencode.ai"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="ai-link">opencode.ai</a>.
                        </p>
                    </div>

                    <div class="tools-actions tools-reset-row">
                        <span class="spacer" />
                        <button
                            class="btn small"
                            title="Restore Appearance, Diff & Files, and Refresh settings to defaults"
                            @click="resetGeneral()">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                            Reset to defaults
                        </button>
                    </div>
                </template>

                <template v-else>
                    <p class="tools-hint">
                        Generate commit messages from your staged changes with OpenCode Zen Go. Get a token at
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
                                class="btn primary small"
                                :disabled="!aiToken.trim() || connecting"
                                @click="connectProvider()">
                                <i-lucide-loader-circle
                                    v-if="connecting"
                                    class="spinning"
                                    width="13"
                                    height="13" />
                                <i-lucide-plug-zap
                                    v-else
                                    width="13"
                                    height="13" />
                                {{ connecting ? 'Connecting…' : 'Connect' }}
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