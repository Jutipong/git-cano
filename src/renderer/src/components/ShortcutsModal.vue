<script setup lang="ts">
    import { computed, useTemplateRef } from 'vue'

    import { useUiStore } from '../stores/ui'
    import { useModalA11y } from '../utils/modalA11y'
    import {
        CUSTOM_SHORTCUT_IDS,
        SHORTCUTS,
        SHORTCUT_GROUPS,
        currentPlatform,
        formatCombo,
        formatComboMac,
        type CustomShortcutId,
        type ShortcutGroupId,
    } from '../utils/shortcuts'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const dialog = useTemplateRef<HTMLElement>('dialog')

    useModalA11y({
        active: () => true,
        container: dialog,
        onClose: () => emit('close'),
    })

    const ui = useUiStore()
    /** The help sheet only shows the platform the app is running on — the other column was pure noise. */
    const platform = currentPlatform()
    const platformLabel = platform === 'mac' ? 'macOS' : 'Windows'
    const formatComboFor = platform === 'mac' ? formatComboMac : formatCombo

    /** One keycap per '+'-separated key, so long combos stay readable ("Ctrl+Shift+Tab" → three caps). */
    function keycaps(combo: string): string[] {
        return formatComboFor(combo).split('+')
    }

    /** Effective combos for one row: the customized value on this platform, plus double-Shift for the palette. */
    function shortcutCombos(id: string): string[] {
        if (!(CUSTOM_SHORTCUT_IDS as string[]).includes(id)) {
            return SHORTCUTS.find(shortcut => shortcut.id === id)![platform]
        }
        const combos = [ui.getShortcut(id as CustomShortcutId, platform)]
        if (id === 'commandPalette') combos.push('Shift+Shift')
        return combos
    }

    /** Two balanced reference columns: Sync + Terminal on the left, Repository + General on the right. */
    const COLUMN_GROUPS: ShortcutGroupId[][] = [
        ['sync', 'terminal'],
        ['repo', 'general'],
    ]

    const columns = computed(() =>
        COLUMN_GROUPS.map(groupIds =>
            groupIds.map(id => ({
                ...SHORTCUT_GROUPS.find(group => group.id === id)!,
                items: SHORTCUTS.filter(shortcut => shortcut.group === id).map(shortcut => ({
                    id: shortcut.id,
                    label: shortcut.label,
                    combos: shortcutCombos(shortcut.id).map(keycaps),
                })),
            }))
        )
    )
</script>

<template>
    <div class="modal-overlay">
        <div
            ref="dialog"
            class="rebase-modal shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-modal-title"
            tabindex="-1">
            <div class="rebase-modal-header">
                <strong id="shortcuts-modal-title">Keyboard shortcuts</strong>
                <span class="shortcuts-platform">{{ platformLabel }}</span>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    aria-label="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="shortcuts-modal-body">
                <div class="shortcuts-columns">
                    <div
                        v-for="(column, columnIndex) in columns"
                        :key="columnIndex"
                        class="shortcuts-column">
                        <section
                            v-for="group in column"
                            :key="group.id"
                            class="shortcuts-group"
                            :aria-labelledby="`shortcuts-group-${group.id}`">
                            <h3
                                :id="`shortcuts-group-${group.id}`"
                                class="shortcuts-group-title">
                                {{ group.title }}
                            </h3>
                            <div
                                v-for="shortcut in group.items"
                                :key="shortcut.id"
                                class="shortcuts-row">
                                <span class="shortcuts-label">{{ shortcut.label }}</span>
                                <span class="shortcuts-keys">
                                    <template
                                        v-for="(combo, comboIndex) in shortcut.combos"
                                        :key="comboIndex">
                                        <span
                                            v-if="comboIndex"
                                            class="shortcut-or"
                                            >or</span
                                        >
                                        <span class="shortcut-combo">
                                            <template
                                                v-for="(part, partIndex) in combo"
                                                :key="partIndex">
                                                <span
                                                    v-if="partIndex"
                                                    class="shortcut-plus"
                                                    aria-hidden="true"
                                                    >+</span
                                                >
                                                <kbd>{{ part }}</kbd>
                                            </template>
                                        </span>
                                    </template>
                                </span>
                            </div>
                        </section>
                    </div>
                </div>
                <div class="shortcuts-notes">
                    <p v-if="platform === 'mac'">⌘ works system-wide alongside Ctrl on macOS.</p>
                    <p>Tab cycling and full height work while the terminal panel has focus.</p>
                </div>
            </div>
        </div>
    </div>
</template>
