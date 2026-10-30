<script setup lang="ts">
    import { reactive, watch, inject, nextTick, ref, useTemplateRef } from 'vue'
    import IAndrsrxnTerminalSquare from '~icons/andrsrxn/terminal-square'
    import ILucideGlobe2 from '~icons/lucide/globe2'
    import ILucideKeyboard from '~icons/lucide/keyboard'
    import ILucidePalette from '~icons/lucide/palette'
    import ILucideSettings2 from '~icons/lucide/settings2'
    import ILucideSlidersHorizontal from '~icons/lucide/sliders-horizontal'
    import ILucideSparkles from '~icons/lucide/sparkles'

    import { useUpdaterStore } from '../stores/updater'
    import { useModalA11y } from '../utils/modalA11y'
    import { SETTINGS_TABS, type SettingsTabKey } from '../utils/settingsTabs'
    import CloseXIcon from './CloseXIcon.vue'
    import AiSettings from './settings/AiSettings.vue'
    import AppearanceSettings from './settings/AppearanceSettings.vue'
    import GeneralSettings from './settings/GeneralSettings.vue'
    import RemotesSettings from './settings/RemotesSettings.vue'
    import ShortcutsSettings from './settings/ShortcutsSettings.vue'
    import TerminalSettings from './settings/TerminalSettings.vue'

    import type { ToastKind } from '../stores/uiTransient'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const props = defineProps<{
        initialTab?: SettingsTabKey
        refresh: () => Promise<unknown>
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const dialog = useTemplateRef<HTMLElement>('dialog')

    useModalA11y({
        active: () => true,
        container: dialog,
        onClose: () => emit('close'),
    })


    // Update check against GitHub Releases; the installed Windows build (Setup .exe)
    // additionally downloads/installs in-app via electron-updater (see stores/updater).
    // State lives in the shared updater store so the sidebar button reacts to the same result.
    const updater = useUpdaterStore()
    void updater.ensureAutoSupport().catch(() => {})

    /** Tab strip content comes from the shared list so the command palette's Settings rows stay in step. */
    const TABS = SETTINGS_TABS
    const tab = ref<SettingsTabKey>(props.initialTab ?? 'appearance')

    function onSettingsTabKeydown(event: KeyboardEvent, key: SettingsTabKey) {
        const index = TABS.findIndex(item => item.key === key)
        if (index < 0) return
        let next = index
        if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
        else if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = TABS.length - 1
        else return
        event.preventDefault()
        tab.value = TABS[next].key
        void nextTick(() => document.getElementById(`settings-tab-${TABS[next].key}`)?.focus())
    }

    // The palette's Settings rows land while this modal may already be open (the palette opens over it), so a late
    // `initialTab` has to switch the visible tab too — a prop read only at setup would leave the modal on the old tab.
    watch(
        () => props.initialTab,
        value => {
            if (value) tab.value = value
        }
    )

    // Remotes and AI keep their drafts across tab switches, so they stay mounted once visited.
    const visitedTabs = reactive(new Set<SettingsTabKey>([tab.value]))
    watch(tab, value => {
        visitedTabs.add(value)
    })


</script>

<template>
    <div class="modal-overlay">
        <div
            ref="dialog"
            class="rebase-modal tools-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tools-modal-title"
            tabindex="-1">
            <div class="rebase-modal-header">
                <strong
                    id="tools-modal-title"
                    class="tools-modal-title">
                    <i-lucide-settings2
                        width="17"
                        height="17"
                        aria-hidden="true" />
                    Settings
                </strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    aria-label="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div
                class="tools-tabs"
                role="tablist"
                aria-label="Settings sections">
                <button
                    v-for="tabItem in TABS"
                    :key="tabItem.key"
                    :id="`settings-tab-${tabItem.key}`"
                    class="graph-filter"
                    :class="{ active: tab === tabItem.key }"
                    role="tab"
                    :aria-selected="tab === tabItem.key"
                    aria-controls="settings-panel"
                    :tabindex="tab === tabItem.key ? 0 : -1"
                    @click="tab = tabItem.key"
                    @keydown="onSettingsTabKeydown($event, tabItem.key)">
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
                    <i-andrsrxn-terminal-square
                        v-else-if="tabItem.key === 'terminal'"
                        width="13"
                        height="13" />
                    <i-lucide-sparkles
                        v-else
                        width="13"
                        height="13" />
                    {{ tabItem.label }}
                </button>
            </div>
            <div
                id="settings-panel"
                class="tools-body general-body"
                role="tabpanel"
                :aria-labelledby="`settings-tab-${tab}`">
                <AppearanceSettings v-if="tab === 'appearance'" />

                <GeneralSettings v-else-if="tab === 'general'" />

                <TerminalSettings v-else-if="tab === 'terminal'" />

                <ShortcutsSettings v-else-if="tab === 'shortcuts'" />

                <!-- v-show needs a real element: both settings components have fragment roots, so the
                     directive would be dropped and a visited tab would stay visible on every other tab. -->
                <div
                    v-if="visitedTabs.has('auth')"
                    v-show="tab === 'auth'"
                    class="settings-tab-pane">
                    <RemotesSettings :refresh="props.refresh" />
                </div>
                <div
                    v-if="visitedTabs.has('ai')"
                    v-show="tab === 'ai'"
                    class="settings-tab-pane">
                    <AiSettings @close="emit('close')" />
                </div>

            </div>
        </div>
    </div>
</template>
