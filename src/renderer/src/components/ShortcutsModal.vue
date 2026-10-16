<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted } from 'vue'

    import { useUiStore } from '../stores/ui'
    import { CUSTOM_SHORTCUT_IDS, SHORTCUTS, SHORTCUT_GROUPS, formatCombo, formatComboMac, isMac, type CustomShortcutId } from '../utils/shortcuts'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()

    const ui = useUiStore()

    const groups = computed(() =>
        SHORTCUT_GROUPS.map(group => ({
            ...group,
            items: SHORTCUTS.filter(shortcut => shortcut.group === group.id).map(shortcut => {
                if ((CUSTOM_SHORTCUT_IDS as string[]).includes(shortcut.id)) {
                    const macCombo = ui.getShortcut(shortcut.id as CustomShortcutId, 'mac')
                    const winCombo = ui.getShortcut(shortcut.id as CustomShortcutId, 'win')
                    const mac = [formatComboMac(macCombo)]
                    const win = [formatCombo(winCombo)]
                    // Command palette always keeps double-Shift as a fixed alternative.
                    if (shortcut.id === 'commandPalette') {
                        mac.push('Shift+Shift')
                        win.push('Shift+Shift')
                    }
                    return { ...shortcut, mac, win }
                }
                return shortcut
            }),
        }))
    )

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        // Stop at the top dialog — Settings may be open underneath and must stay open.
        if (event.key === 'Escape') {
            event.stopPropagation()
            emit('close')
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal shortcuts-modal">
            <div class="rebase-modal-header">
                <strong>Keyboard shortcuts</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="shortcuts-modal-body">
                <div class="shortcuts-table">
                    <span class="shortcuts-head" />
                    <span class="shortcuts-head">macOS</span>
                    <span class="shortcuts-head">Windows</span>
                    <span
                        class="shortcuts-divider"
                        aria-hidden="true" />
                    <template
                        v-for="(group, groupIndex) in groups"
                        :key="group.id">
                        <span
                            class="shortcuts-group-title"
                            :class="{ 'is-first': groupIndex === 0 }"
                            >{{ group.title }}</span
                        >
                        <template
                            v-for="shortcut in group.items"
                            :key="shortcut.id">
                            <span class="shortcuts-label">{{ shortcut.label }}</span>
                            <span class="shortcuts-keys">
                                <kbd
                                    v-for="key in shortcut.mac"
                                    :key="key"
                                    >{{ key }}</kbd
                                >
                            </span>
                            <span class="shortcuts-keys">
                                <kbd
                                    v-for="key in shortcut.win"
                                    :key="key"
                                    >{{ key }}</kbd
                                >
                            </span>
                        </template>
                    </template>
                </div>
                <p
                    v-if="isMac"
                    class="shortcuts-note">
                    ⌘ works system-wide alongside Ctrl on macOS.
                </p>
            </div>
        </div>
    </div>
</template>
