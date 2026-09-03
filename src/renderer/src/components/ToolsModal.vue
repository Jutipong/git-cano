<script setup lang="ts">
    import Moon from '~icons/lucide/moon'
    import Sun from '~icons/lucide/sun'

    import { useUiStore, FONT_SIZE_OPTIONS, REFRESH_INTERVAL_OPTIONS, ZOOM_OPTIONS, type ThemeOption } from '../stores/ui'
    import { confirmDialog } from '../utils/confirm'
    import CloseXIcon from './CloseXIcon.vue'
    import RemoteManager from './RemoteManager.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { ToastKind } from '../stores/uiTransient'
    import type { AiConfig, AiProvider, AiProviderConfig, GoModel, SshKeyInfo, SshTestResult } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const props = defineProps<{
        initialTab?: 'appearance' | 'general' | 'auth' | 'hook' | 'ai'
        refresh: () => Promise<unknown>
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const ui = useUiStore()
    const repoStore = useRepoStore()

    // Opt-in Windows status accelerators (persisted main-side in settings.json)
    const statusAccelerators = ref(false)
    onMounted(async () => {
        statusAccelerators.value = await window.api.getStatusAccelerators().catch(() => false)
    })
    async function toggleStatusAccelerators() {
        const next = !statusAccelerators.value
        statusAccelerators.value = next
        try {
            await window.api.setStatusAccelerators(next)
        } catch (error) {
            statusAccelerators.value = !next
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    // Default folder for directory-picker dialogs (Open from local / New repo / Clone destination),
    // persisted main-side in settings.json — falls back to the parent of the most recent repo when empty.
    const defaultOpenDir = ref('')
    onMounted(async () => {
        defaultOpenDir.value = await window.api.getDefaultOpenDir().catch(() => '')
    })
    async function persistDefaultOpenDir(value: string) {
        const dir = value.trim()
        try {
            await window.api.setDefaultOpenDir(dir)
            notify(dir ? 'Default open folder saved' : 'Default open folder cleared', 'success')
        } catch (error) {
            defaultOpenDir.value = await window.api.getDefaultOpenDir().catch(() => '')
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }
    async function browseDefaultOpenDir() {
        try {
            const dir = await window.api.pickDirectory()
            if (!dir) return
            defaultOpenDir.value = dir
            await persistDefaultOpenDir(dir)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }
    function clearDefaultOpenDir() {
        defaultOpenDir.value = ''
        void persistDefaultOpenDir('')
    }

    const TABS = [
        { key: 'appearance', label: 'Appearance' },
        { key: 'general', label: 'General' },
        { key: 'auth', label: 'Remotes' },
        { key: 'hook', label: 'Hook' },
        { key: 'ai', label: 'AI' },
    ] as const
    const tab = ref(props.initialTab ?? 'appearance')

    const REFRESH_OPTIONS = REFRESH_INTERVAL_OPTIONS.map(value => ({ value, label: `${value} min` }))
    const FONT_OPTIONS = FONT_SIZE_OPTIONS.map(value => ({ value, label: `${value}px` }))
    const DISPLAY_ZOOM_OPTIONS = ZOOM_OPTIONS.map(value => ({ value, label: `${value}%` }))

    const themeIcon = (option: ThemeOption) => (option.icon === 'sun' ? Sun : Moon)

    const ai = useAiStore()
    const PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
        { value: 'none', label: 'No' },
        { value: 'opencode-go', label: 'OpenCode Go' },
        { value: 'openrouter', label: 'OpenRouter' },
    ]
    const selectedProvider = ref<AiProvider>('opencode-go')
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
            message: 'Reset general settings to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetGeneral()
        notify('Settings reset to defaults', 'success')
    }

    async function resetAppearance() {
        const ok = await confirmDialog({
            message: 'Reset appearance settings to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetAppearance()
        notify('Appearance reset to defaults', 'success')
    }

    const auth = useAuthStore()
    const authSub = ref<'ssh' | 'github'>('ssh')
    const activeKey = computed<SshKeyInfo | null>(() => auth.keys.find(key => key.privateKeyPath === auth.config.sshKeyPath) ?? null)
    const keyOpen = ref(false)

    function toggleKeyPop() {
        keyOpen.value = !keyOpen.value
    }

    async function selectKey(keyPath: string) {
        keyOpen.value = false
        if (keyPath === auth.config.sshKeyPath) return
        await setActiveKey(keyPath)
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!keyOpen.value) return
        if ((event.target as HTMLElement | null)?.closest('.ssh-key-wrap')) return
        keyOpen.value = false
    }

    onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
    onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
    const sshTesting = ref(false)
    const sshTestResult = ref<SshTestResult | null>(null)
    const generating = ref(false)
    const genName = ref('')
    const genComment = ref('')
    const genPassphrase = ref('')
    const githubBusy = ref(false)
    const githubTokenDraft = ref('')

    async function setActiveKey(keyPath: string) {
        try {
            await auth.save({ ...auth.config, sshKeyPath: keyPath })
            await auth.refreshKeys()
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function copyPublicKey(key: SshKeyInfo) {
        try {
            await navigator.clipboard.writeText(key.publicKey)
            notify('Public key copied to clipboard', 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function testKey(key: SshKeyInfo) {
        if (sshTesting.value) return
        sshTesting.value = true
        sshTestResult.value = null
        try {
            sshTestResult.value = await window.api.auth.sshTest(key.privateKeyPath)
        } catch (error) {
            sshTestResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            sshTesting.value = false
        }
    }

    async function deleteKey(key: SshKeyInfo) {
        const ok = await confirmDialog({
            message: `Permanently delete "${key.name}" (private + public key) from ~/.ssh? This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        try {
            auth.keys = await window.api.auth.sshDelete(key.privateKeyPath)
            notify(`SSH key "${key.name}" deleted`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    /** Key name without a trailing ".pub" — the input may include the extension (placeholder shows "filename.pub"). */
    const genKeyName = computed(() => genName.value.trim().replace(/\.pub$/i, ''))

    /** Same rules as `generateSshKey` in the main process — validated live so the Generate button can be disabled. */
    const genNameError = computed<string | null>(() => {
        if (!genName.value.trim()) return null
        const name = genKeyName.value
        if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
            return 'Use only letters, numbers, "-", ".", "_" — must start with a letter or number'
        }
        if (auth.keys.some(key => key.name === `${name}.pub`)) {
            return `Key "${name}.pub" already exists in ~/.ssh`
        }
        return null
    })

    async function generateKey() {
        if (generating.value || genNameError.value || !genKeyName.value) return
        generating.value = true
        try {
            const key = await window.api.auth.sshGenerate(genKeyName.value, genComment.value, genPassphrase.value)
            await auth.refreshKeys()
            notify(`SSH key "${key.name}" created`, 'success')
            genName.value = ''
            genComment.value = ''
            genPassphrase.value = ''
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            generating.value = false
        }
    }

    async function openSshDir() {
        try {
            await window.api.auth.openSshDir()
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function saveGithubToken() {
        const token = githubTokenDraft.value.trim()
        if (!token || githubBusy.value) return
        githubBusy.value = true
        try {
            const user = await window.api.auth.githubVerify(token)
            await auth.save({ ...auth.config, githubToken: token })
            githubTokenDraft.value = ''
            notify(`Signed in as ${user.login}`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            githubBusy.value = false
        }
    }

    async function signOutGithub() {
        try {
            await auth.save({ ...auth.config, githubToken: '' })
            notify('GitHub token removed', 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function openTokenPage() {
        try {
            await window.api.auth.openGithubTokenPage()
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function refreshGithubStatus() {
        await auth.refreshGithubUser()
    }

    let authLoaded = false
    async function loadAuthTab() {
        if (authLoaded) return
        authLoaded = true
        await auth.load()
        await auth.refreshKeys()
        await refreshGithubStatus()
    }

    watch(
        tab,
        async current => {
            if (current === 'ai') await loadAiTab()
            if (current === 'auth') await loadAuthTab()
        },
        // initial tab may already be 'ai'/'auth' (e.g. opened straight from the AI commit dropdown) — load it on mount too
        { immediate: true }
    )

    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') emit('close')
    }

    function openShortcuts() {
        emit('close')
        repoStore.shortcutsOpen = true
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
                    <CloseXIcon />
                </button>
            </div>
            <div class="tools-tabs">
                <button
                    v-for="tabItem in TABS"
                    :key="tabItem.key"
                    class="graph-filter"
                    :class="{ active: tab === tabItem.key }"
                    @click="tab = tabItem.key">
                    <i-lucide-palette
                        v-if="tabItem.key === 'appearance'"
                        width="13"
                        height="13" />
                    <i-lucide-sliders-horizontal
                        v-else-if="tabItem.key === 'general'"
                        width="13"
                        height="13" />
                    <i-lucide-zap
                        v-else-if="tabItem.key === 'hook'"
                        width="13"
                        height="13" />
                    <i-lucide-globe2
                        v-else-if="tabItem.key === 'auth'"
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
                <template v-if="tab === 'appearance'">
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

                    <div class="tools-actions tools-reset-row">
                        <span class="spacer" />
                        <button
                            class="btn danger small"
                            title="Restore appearance settings to defaults"
                            @click="resetAppearance()">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                            Reset to defaults
                        </button>
                    </div>
                </template>

                <template v-else-if="tab === 'general'">
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

                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-folder-open
                                width="13"
                                height="13" />
                            Folders
                        </strong>
                        <label class="ai-field">
                            <span>Default folder for opening repositories</span>
                            <div class="ai-token-row">
                                <input
                                    v-model="defaultOpenDir"
                                    type="text"
                                    placeholder="Last used folder"
                                    autocomplete="off"
                                    @change="persistDefaultOpenDir(defaultOpenDir)" />
                                <button
                                    class="btn small"
                                    title="Browse for a folder"
                                    @click="browseDefaultOpenDir()">
                                    <i-lucide-folder-open
                                        width="13"
                                        height="13" />
                                    Browse…
                                </button>
                                <button
                                    v-if="defaultOpenDir.trim()"
                                    class="btn danger small"
                                    title="Clear — start from the last used folder"
                                    @click="clearDefaultOpenDir()">
                                    <i-lucide-x
                                        width="13"
                                        height="13" />
                                    Clear
                                </button>
                            </div>
                        </label>
                        <span class="setting-hint">
                            Folder-picker dialogs (Open from local, New repository, Clone destination) start here. When empty, the parent
                            folder of the most recently opened repository is used.
                        </span>
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-zap
                                width="13"
                                height="13" />
                            Performance
                        </strong>
                        <AppCheckbox
                            class="setting-toggle"
                            :model-value="statusAccelerators"
                            @update:model-value="toggleStatusAccelerators">
                            Speed up git status (large repos / Windows)
                        </AppCheckbox>
                        <span class="setting-hint">
                            Lets git cache worktree state (fsmonitor + untracked cache) so refreshes are much faster. Writes to each opened
                            repository's local git config; takes effect the next time the repo is opened.
                        </span>
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-keyboard
                                width="13"
                                height="13" />
                            Shortcuts
                        </strong>
                        <button
                            class="btn small"
                            title="Show the keyboard shortcuts list"
                            @click="openShortcuts()">
                            <i-lucide-keyboard
                                width="13"
                                height="13" />
                            Keyboard shortcuts…
                        </button>
                        <span class="setting-hint">
                            Pull, push, fetch, open repository and open settings all have shortcuts. Press <kbd>?</kbd> anywhere to see the
                            full list.
                        </span>
                    </div>

                    <div class="tools-actions tools-reset-row">
                        <span class="spacer" />
                        <button
                            class="btn danger small"
                            title="Restore general settings to defaults"
                            @click="resetGeneral()">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                            Reset to defaults
                        </button>
                    </div>
                </template>

                <template v-else-if="tab === 'auth'">
                    <RemoteManager :refresh="props.refresh" />

                    <div class="tools-section">
                        <div class="setting-choice-row">
                            <button
                                type="button"
                                class="setting-chip"
                                :class="{ active: authSub === 'ssh' }"
                                @click="authSub = 'ssh'">
                                SSH
                            </button>
                            <button
                                type="button"
                                class="setting-chip"
                                :class="{ active: authSub === 'github' }"
                                @click="authSub = 'github'">
                                GitHub
                            </button>
                        </div>
                    </div>

                    <template v-if="authSub === 'ssh'">
                        <div class="tools-section">
                            <strong class="tools-section-title">
                                <i-lucide-key-round
                                    width="13"
                                    height="13" />
                                Active SSH key
                            </strong>
                            <label class="ai-field">
                                <span>Key used for SSH remotes (applies to all repositories)</span>
                                <div class="ssh-key-wrap">
                                    <button
                                        type="button"
                                        class="workspace-btn"
                                        title="Choose SSH key"
                                        @click="toggleKeyPop()">
                                        <i-lucide-key-round
                                            width="13"
                                            height="13" />
                                        <span class="workspace-btn-name">
                                            {{ activeKey?.name ?? 'None — use system default' }}
                                        </span>
                                        <i-lucide-chevron-down
                                            width="12"
                                            height="12" />
                                    </button>
                                    <div
                                        v-if="keyOpen"
                                        class="workspace-pop">
                                        <button
                                            type="button"
                                            class="workspace-item"
                                            :class="{ active: !activeKey }"
                                            @click="selectKey('')">
                                            <i-lucide-check
                                                v-if="!activeKey"
                                                width="13"
                                                height="13" />
                                            <span
                                                v-else
                                                class="workspace-item-spacer" />
                                            <span class="workspace-item-name">None — use system default</span>
                                        </button>
                                        <div
                                            v-for="key in auth.keys"
                                            :key="key.privateKeyPath"
                                            class="workspace-row">
                                            <button
                                                type="button"
                                                class="workspace-item"
                                                :class="{ active: key.active }"
                                                :title="key.fingerprint || key.publicKeyPath"
                                                @click="selectKey(key.privateKeyPath)">
                                                <i-lucide-check
                                                    v-if="key.active"
                                                    width="13"
                                                    height="13" />
                                                <span
                                                    v-else
                                                    class="workspace-item-spacer" />
                                                <span class="workspace-item-name">{{ key.name }}</span>
                                            </button>
                                            <button
                                                v-if="!key.active"
                                                class="icon-btn danger workspace-item-delete"
                                                title="Delete key pair from ~/.ssh"
                                                @click="deleteKey(key)">
                                                <i-lucide-trash-2
                                                    width="12"
                                                    height="12" />
                                            </button>
                                        </div>
                                        <p
                                            v-if="auth.keys.length === 0"
                                            class="tools-section-hint">
                                            No SSH keys found — generate one below.
                                        </p>
                                    </div>
                                </div>
                            </label>
                            <template v-if="activeKey">
                                <div class="tools-actions ssh-key-actions">
                                    <button
                                        class="btn small"
                                        :disabled="sshTesting"
                                        :title="`Test ${activeKey.name} against the repo's SSH remote`"
                                        @click="testKey(activeKey)">
                                        <i-lucide-flask-conical
                                            v-if="!sshTesting"
                                            width="13"
                                            height="13" />
                                        <ThinkSpinner
                                            v-else
                                            compact />
                                        Test
                                    </button>
                                    <button
                                        class="btn small"
                                        :title="`Copy ${activeKey.name} public key to clipboard`"
                                        @click="copyPublicKey(activeKey)">
                                        <i-lucide-copy
                                            width="13"
                                            height="13" />
                                        Copy
                                    </button>
                                </div>
                                <span
                                    v-if="sshTestResult"
                                    class="ai-test-result"
                                    :class="sshTestResult.ok ? 'ok' : 'err'"
                                    >{{ sshTestResult.message }}</span
                                >
                            </template>
                        </div>

                        <div class="tools-section">
                            <strong class="tools-section-title">Generate new key</strong>
                            <label class="ai-field">
                                <span>File name</span>
                                <div class="ai-token-row">
                                    <input
                                        v-model="genName"
                                        type="text"
                                        placeholder="filename.pub"
                                        autocomplete="off" />
                                </div>
                                <div
                                    v-if="genNameError"
                                    class="auth-gen-error">
                                    {{ genNameError }}
                                </div>
                            </label>
                            <label class="ai-field">
                                <span>Comment (email)</span>
                                <div class="ai-token-row">
                                    <input
                                        v-model="genComment"
                                        type="text"
                                        placeholder="you@example.com"
                                        autocomplete="off" />
                                </div>
                            </label>
                            <label class="ai-field">
                                <span>Passphrase (optional, not stored)</span>
                                <div class="ai-token-row">
                                    <input
                                        v-model="genPassphrase"
                                        type="password"
                                        placeholder="leave empty for no passphrase"
                                        autocomplete="new-password" />
                                    <button
                                        class="btn success small"
                                        :disabled="generating || !genName.trim() || genNameError !== null"
                                        @click="generateKey()">
                                        <ThinkSpinner
                                            v-if="generating"
                                            compact />
                                        <i-lucide-plus
                                            v-else
                                            width="13"
                                            height="13" />
                                        Generate
                                    </button>
                                </div>
                            </label>
                            <div class="tools-actions">
                                <button
                                    class="btn small"
                                    @click="openSshDir()">
                                    <i-lucide-folder-open
                                        width="13"
                                        height="13" />
                                    Open ~/.ssh
                                </button>
                            </div>
                            <p class="tools-section-hint">
                                Copy the public key to your host (e.g. GitHub → Settings → SSH keys, or GitLab → SSH Keys) then press Test
                                to verify the connection.
                            </p>
                        </div>
                    </template>

                    <template v-else>
                        <div class="tools-section">
                            <strong class="tools-section-title">
                                <i-lucide-user-round
                                    width="13"
                                    height="13" />
                                GitHub account
                            </strong>
                            <div
                                v-if="auth.githubUser"
                                class="github-account">
                                <img
                                    v-if="auth.githubUser.avatarUrl"
                                    class="github-avatar"
                                    :src="auth.githubUser.avatarUrl"
                                    :alt="auth.githubUser.login" />
                                <div class="github-account-meta">
                                    <strong>
                                        {{ auth.githubUser.login }}
                                        <span
                                            v-if="auth.githubUser.name"
                                            class="github-account-name"
                                            >{{ auth.githubUser.name }}</span
                                        >
                                    </strong>
                                    <small
                                        v-if="auth.githubUser.bio"
                                        class="github-account-bio"
                                        >{{ auth.githubUser.bio }}</small
                                    >
                                    <small class="github-account-stats">
                                        <i-lucide-folder-git-2
                                            width="12"
                                            height="12" />
                                        {{ auth.githubUser.publicRepos }} repos
                                        <span class="dot-sep">·</span>
                                        <i-lucide-users
                                            width="12"
                                            height="12" />
                                        {{ auth.githubUser.followers }} followers
                                    </small>
                                </div>
                            </div>
                            <p
                                v-else
                                class="tools-section-hint">
                                Not signed in.
                            </p>
                            <p class="tools-section-hint">
                                The token is used for HTTPS pushes/pulls to github.com and is stored locally in the app data folder.
                            </p>
                        </div>

                        <div class="tools-section">
                            <label class="ai-field">
                                <span>Personal access token (scopes: repo)</span>
                                <div class="ai-token-row">
                                    <input
                                        v-model="githubTokenDraft"
                                        type="password"
                                        placeholder="ghp_…"
                                        autocomplete="off" />
                                    <button
                                        class="btn success small"
                                        :disabled="!githubTokenDraft.trim() || githubBusy"
                                        @click="saveGithubToken()">
                                        <ThinkSpinner
                                            v-if="githubBusy"
                                            compact />
                                        <i-lucide-check
                                            v-else
                                            width="13"
                                            height="13" />
                                        Verify &amp; save
                                    </button>
                                </div>
                            </label>
                            <div class="tools-actions">
                                <button
                                    class="btn small"
                                    title="Opens your default browser to create a token"
                                    @click="openTokenPage()">
                                    <i-lucide-external-link
                                        width="13"
                                        height="13" />
                                    Create token in browser
                                </button>
                                <button
                                    v-if="auth.githubUser"
                                    class="btn danger small"
                                    @click="signOutGithub()">
                                    <i-lucide-trash-2
                                        width="13"
                                        height="13" />
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </template>
                </template>

                <template v-else-if="tab === 'hook'">
                    <div class="tools-section">
                        <strong class="tools-section-title">Commit message</strong>
                        <span class="setting-label">Format before generating</span>
                        <div class="setting-choice-row">
                            <button
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.formatBeforeGenerate }"
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
                            <code>.oxfmtrc.json</code>; otherwise the message is generated as-is.
                        </p>
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
                                    @keydown.escape="modelDropdownOpen = false" />
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
                                        <span>{{ m.name }}</span>
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
                                    @keydown.escape="modelDropdownOpen = false" />
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
                                        <span>{{ m.name }}</span>
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
                        <p class="tools-section-hint">
                            AI features are disabled. Select a provider above to enable commit-message generation.
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
                                v-if="aiTestResult"
                                class="ai-test-result"
                                :class="aiTestResult.ok ? 'ok' : 'err'"
                                >{{ aiTestResult.message }}</span
                            >
                        </template>
                        <span class="spacer" />
                        <button
                            class="btn small"
                            :disabled="aiTesting"
                            @click="emit('close')">
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
