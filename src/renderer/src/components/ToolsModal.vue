<script setup lang="ts">
    import { computed, onBeforeUnmount, onUnmounted, reactive, watch, inject, onMounted, ref } from 'vue'
    import ILucideBell from '~icons/lucide/bell'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideCopy from '~icons/lucide/copy'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideExternalLink from '~icons/lucide/external-link'
    import ILucideFlaskConical from '~icons/lucide/flask-conical'
    import ILucideFolderGit2 from '~icons/lucide/folder-git-2'
    import ILucideFolderOpen from '~icons/lucide/folder-open'
    import ILucideGlobe2 from '~icons/lucide/globe2'
    import ILucideKeyRound from '~icons/lucide/key-round'
    import ILucideKeyboard from '~icons/lucide/keyboard'
    import Moon from '~icons/lucide/moon'
    import ILucidePalette from '~icons/lucide/palette'
    import ILucidePlus from '~icons/lucide/plus'
    import ILucideRefreshCw from '~icons/lucide/refresh-cw'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import ILucideSave from '~icons/lucide/save'
    import ILucideSettings2 from '~icons/lucide/settings2'
    import ILucideSlidersHorizontal from '~icons/lucide/sliders-horizontal'
    import ILucideSparkles from '~icons/lucide/sparkles'
    import Sun from '~icons/lucide/sun'
    import ILucideTrash2 from '~icons/lucide/trash-2'
    import ILucideUserRound from '~icons/lucide/user-round'
    import ILucideUsers from '~icons/lucide/users'
    import ILucideX from '~icons/lucide/x'
    import ILucideZap from '~icons/lucide/zap'

    import { useAiStore } from '../stores/ai'
    import { useAuthStore } from '../stores/auth'
    import { useRepoStore } from '../stores/repo'
    import { useUpdaterStore } from '../stores/updater'
    import { useUiStore, FONT_SIZE_OPTIONS, REFRESH_INTERVAL_OPTIONS, TOAST_DURATION_OPTIONS, UPDATE_CHECK_HOURS_OPTIONS, type ThemeOption } from '../stores/ui'
    import { confirmDialog } from '../utils/confirm'
    import {
        CUSTOM_SHORTCUT_IDS,
        eventToCombo,
        formatCombo,
        formatComboMac,
        isReservedCombo,
        isValidSyncCombo,
        type CustomShortcutId,
        type ShortcutPlatform,
    } from '../utils/shortcuts'
    import AppCheckbox from './AppCheckbox.vue'
    import CloseXIcon from './CloseXIcon.vue'
    import RemoteManager from './RemoteManager.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { ToastKind } from '../stores/uiTransient'
    import type { AiConfig, AiProvider, AiProviderConfig, GoModel, SshKeyInfo, SshTestResult } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const props = defineProps<{
        initialTab?: 'appearance' | 'general' | 'auth' | 'ai' | 'shortcuts'
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

    // Manual update check against GitHub Releases (auto-update via electron-updater lands later).
    // State lives in the shared updater store so the sidebar button reacts to the same result.
    const updater = useUpdaterStore()
    const updateChecking = computed(() => updater.status === 'checking')
    const updateStatus = computed<string | null>(() => {
        if (updater.status === 'checking') return 'Checking…'
        if (updater.status === 'available' && updater.currentVersion)
            return `Update available: v${updater.currentVersion} → ${updater.latestVersion}`
        if (updater.status === 'up-to-date' && updater.currentVersion)
            return updater.latestVersion
                ? `You're up to date (v${updater.currentVersion})`
                : `Current v${updater.currentVersion} · no releases published yet`
        if (updater.status === 'error' && updater.error) return `Check failed: ${updater.error}`
        return null
    })
    function checkForUpdateManual() {
        void updater.checkForUpdate(true, notify)
    }

    const TABS = [
        { key: 'appearance', label: 'Appearance' },
        { key: 'general', label: 'General' },
        { key: 'auth', label: 'Remotes' },
        { key: 'ai', label: 'AI' },
        { key: 'shortcuts', label: 'Shortcuts' },
    ] as const
    const tab = ref(props.initialTab ?? 'appearance')

    const REFRESH_OPTIONS = REFRESH_INTERVAL_OPTIONS.map(value => ({ value, label: `${value} min` }))
    const UPDATE_OPTIONS = UPDATE_CHECK_HOURS_OPTIONS.map(value => ({ value, label: value === 0 ? 'Off' : `${value}h` }))
    const TOAST_OPTIONS = TOAST_DURATION_OPTIONS.map(value => ({ value, label: `${value}s` }))
    const FONT_OPTIONS = FONT_SIZE_OPTIONS.map(value => ({ value, label: `${value}px` }))

    const themeIcon = (option: ThemeOption) => (option.icon === 'sun' ? Sun : Moon)
    const darkThemeOptions = computed(() => ui.themeOptions.filter(option => option.kind === 'dark'))
    const lightThemeOptions = computed(() => ui.themeOptions.filter(option => option.kind === 'light'))

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
            if (result.ok) {
                aiTestResult.value = result
                await ai.save(currentConfig())
            } else {
                notify(result.message, 'error')
            }
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
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

    const SHORTCUT_LABELS: Record<CustomShortcutId, string> = {
        fetch: 'Fetch',
        pull: 'Pull',
        push: 'Push',
        openRepo: 'Open repo',
        cloneRepo: 'Clone repo',
        searchCommits: 'Search commits',
        settings: 'Open settings',
        commandPalette: 'Command palette',
    }
    const recording = ref<{ id: CustomShortcutId; platform: ShortcutPlatform } | null>(null)

    function startRecording(id: CustomShortcutId, platform: ShortcutPlatform) {
        recording.value = { id, platform }
    }

    function cancelRecording() {
        recording.value = null
    }

    function isRecording(id: CustomShortcutId, platform: ShortcutPlatform) {
        return recording.value?.id === id && recording.value.platform === platform
    }

    function onRecordKey(event: KeyboardEvent, id: CustomShortcutId, platform: ShortcutPlatform) {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') {
            recording.value = null
            return
        }
        const combo = eventToCombo(event)
        if (!combo) return
        if (!isValidSyncCombo(combo)) {
            notify('Shortcut must include Ctrl (or Cmd)', 'error')
            return
        }
        if (isReservedCombo(combo, ui.effectiveShortcuts(platform), id)) {
            notify(`${formatCombo(combo)} is already in use on ${platform === 'mac' ? 'macOS' : 'Windows'}`, 'error')
            return
        }
        ui.setShortcut(id, combo, platform)
        recording.value = null
        notify(`${SHORTCUT_LABELS[id]} shortcut (${platform === 'mac' ? 'macOS' : 'Windows'}) saved`, 'success')
    }

    // Capture keys anywhere in the modal while recording (button focus is unreliable after v-if swap).
    function onGlobalRecordKey(event: KeyboardEvent) {
        const current = recording.value
        if (!current) return
        onRecordKey(event, current.id, current.platform)
    }

    watch(recording, current => {
        if (current) window.addEventListener('keydown', onGlobalRecordKey, true)
        else window.removeEventListener('keydown', onGlobalRecordKey, true)
    })
    onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalRecordKey, true))

    async function resetShortcutsToDefaults() {
        const ok = await confirmDialog({
            message: 'Reset all custom shortcuts to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetShortcuts()
        recording.value = null
        notify('Shortcuts reset to defaults', 'success')
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
        recording.value = null
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
                    <i-lucide-keyboard
                        v-else-if="tabItem.key === 'shortcuts'"
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
                        <div class="theme-rows">
                            <div class="setting-choice-row">
                                <button
                                    v-for="option in darkThemeOptions"
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
                            <div class="setting-choice-row">
                                <button
                                    v-for="option in lightThemeOptions"
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
                            <i-lucide-download
                                width="13"
                                height="13" />
                            Updates
                        </strong>
                        <span class="setting-label">Check for updates every</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in UPDATE_OPTIONS"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.updateCheckHours === option.value }"
                                @click="ui.updateCheckHours = option.value">
                                {{ option.label }}
                            </button>
                        </div>
                        <div class="tools-actions">
                            <button
                                class="btn small"
                                :disabled="updateChecking"
                                title="Check GitHub Releases for a newer version now"
                                @click="checkForUpdateManual()">
                                <i-lucide-refresh-cw
                                    v-if="!updateChecking"
                                    width="13"
                                    height="13" />
                                <ThinkSpinner
                                    v-else
                                    compact />
                                {{ updateChecking ? 'Checking…' : 'Check now' }}
                            </button>
                            <span
                                v-if="updateStatus"
                                class="setting-hint"
                                >{{ updateStatus }}</span
                            >
                        </div>
                        <span class="setting-hint">
                            Off = manual check only. Automatic install lands with the Setup .exe build; portable and macOS stay manual.
                        </span>
                    </div>

                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-bell
                                width="13"
                                height="13" />
                            Notifications
                        </strong>
                        <span class="setting-label">Toast auto-dismiss after</span>
                        <div class="setting-choice-row">
                            <button
                                v-for="option in TOAST_OPTIONS"
                                :key="option.value"
                                type="button"
                                class="setting-chip"
                                :class="{ active: ui.toastDurationSec === option.value }"
                                @click="ui.toastDurationSec = option.value">
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
                            <code>.oxfmtrc.json</code>; otherwise the message is generated as-is. Formatting worktree files cannot affect a
                            staged-only message, so it applies to the Auto Commit modes and is skipped for Generate Only.
                        </p>
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

                <template v-else-if="tab === 'shortcuts'">
                    <div class="tools-section">
                        <strong class="tools-section-title">
                            <i-lucide-keyboard
                                width="13"
                                height="13" />
                            Keyboard shortcuts
                        </strong>
                        <div class="shortcut-list">
                            <div
                                class="shortcut-row shortcut-head-row"
                                aria-hidden="true">
                                <span />
                                <span class="shortcut-head">macOS</span>
                                <span />
                                <span class="shortcut-head">Windows</span>
                                <span />
                            </div>
                            <div
                                v-for="id in CUSTOM_SHORTCUT_IDS"
                                :key="id"
                                class="shortcut-row">
                                <span class="shortcut-name">{{ SHORTCUT_LABELS[id] }}</span>
                                <kbd
                                    class="shortcut-kbd"
                                    title="macOS (⌘ works as Ctrl)"
                                    >{{ formatComboMac(ui.getShortcut(id, 'mac')) }}</kbd
                                >
                                <button
                                    v-if="!isRecording(id, 'mac')"
                                    class="btn small"
                                    :title="`Change ${SHORTCUT_LABELS[id]} shortcut (macOS)`"
                                    @click="startRecording(id, 'mac')">
                                    Change…
                                </button>
                                <button
                                    v-else
                                    class="btn small shortcut-recording"
                                    title="Press keys, Esc to cancel"
                                    @click="cancelRecording()">
                                    Press keys…
                                </button>
                                <kbd class="shortcut-kbd">{{ formatCombo(ui.getShortcut(id, 'win')) }}</kbd>
                                <button
                                    v-if="!isRecording(id, 'win')"
                                    class="btn small"
                                    :title="`Change ${SHORTCUT_LABELS[id]} shortcut (Windows)`"
                                    @click="startRecording(id, 'win')">
                                    Change…
                                </button>
                                <button
                                    v-else
                                    class="btn small shortcut-recording"
                                    title="Press keys, Esc to cancel"
                                    @click="cancelRecording()">
                                    Press keys…
                                </button>
                            </div>
                        </div>
                        <span class="setting-hint">
                            Click Change… under macOS or Windows then press keys (must include Ctrl or Cmd). Esc cancels. Duplicates are
                            rejected per platform. Command palette also opens with double-Shift (fixed).
                        </span>
                        <div class="tools-actions">
                            <button
                                class="btn small"
                                title="Show the keyboard shortcuts list"
                                @click="openShortcuts()">
                                <i-lucide-keyboard
                                    width="13"
                                    height="13" />
                                Keyboard shortcuts…
                            </button>
                        </div>
                        <span class="setting-hint"> Press <kbd>?</kbd> anywhere to see the full list. </span>
                    </div>

                    <div class="tools-actions tools-reset-row">
                        <span class="spacer" />
                        <button
                            class="btn danger small"
                            title="Reset all custom shortcuts to defaults"
                            @click="resetShortcutsToDefaults()">
                            <i-lucide-rotate-ccw
                                width="13"
                                height="13" />
                            Default
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
                        <p class="tools-section-hint">
                            AI features are disabled. Select a provider above to enable commit-message generation.
                        </p>
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
