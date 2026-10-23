<script setup lang="ts">
    import { inject, onBeforeUnmount, ref, watch } from 'vue'
    import ILucideKeyboard from '~icons/lucide/keyboard'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'

    import { useRepoStore } from '../../stores/repo'
    import { useUiStore } from '../../stores/ui'
    import { confirmDialog } from '../../utils/confirm'
    import {
        CUSTOM_SHORTCUT_IDS,
        eventToCombo,
        formatCombo,
        formatComboMac,
        isReservedCombo,
        isValidSyncCombo,
        type CustomShortcutId,
        type ShortcutPlatform,
    } from '../../utils/shortcuts'

    import type { ToastKind } from '../../stores/uiTransient'

    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const ui = useUiStore()
    const repoStore = useRepoStore()

    const SHORTCUT_LABELS: Record<CustomShortcutId, string> = {
        fetch: 'Fetch',
        pull: 'Pull',
        push: 'Push',
        openRepo: 'Open repo',
        cloneRepo: 'Clone repo',
        searchCommits: 'Search commits',
        settings: 'Open settings',
        commandPalette: 'Command palette',
        terminal: 'Toggle terminal',
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

    function openShortcuts() {
        recording.value = null
        repoStore.shortcutsOpen = true
    }
</script>

<template>
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
            Click Change… under macOS or Windows then press keys (must include Ctrl or Cmd). Esc cancels. Duplicates are rejected per
            platform. Command palette also opens with double-Shift (fixed).
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
