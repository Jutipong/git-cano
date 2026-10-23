<script setup lang="ts">
    import { computed, inject, onMounted, ref } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucidePanelTop from '~icons/lucide/panel-top'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import ILucideSettings2 from '~icons/lucide/settings2'
    import ILucideTerminal from '~icons/lucide/terminal'

    import {
        useUiStore,
        DEFAULT_TERMINAL_FONT_FAMILY,
        TERMINAL_FONT_FAMILY_PRESETS,
        TERMINAL_FONT_SIZE_OPTIONS,
        TERMINAL_MAX_TABS_OPTIONS,
    } from '../../stores/ui'
    import { confirmDialog } from '../../utils/confirm'
    import { isWindows } from '../../utils/shortcuts'
    import { buildTerminalFontFamily, isFontInstalled, primaryFontFamily } from '../../utils/terminalFont'
    import AppCheckbox from '../AppCheckbox.vue'

    import type { ToastKind } from '../../stores/uiTransient'
    import type { TerminalShell } from '@shared/types'

    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const ui = useUiStore()

    /** Terminal → its own text size, deliberately independent of the UI font size above. */
    const TERMINAL_FONT_OPTIONS = TERMINAL_FONT_SIZE_OPTIONS.map(value => ({ value, label: `${value}px` }))
    /**
     * Shell choices — PowerShell 7 is the default, and the resolver in `main/terminal.ts` falls back to Command Prompt on machines where
     * pwsh is not installed. Hidden off Windows, following the repo's rule for Windows-only settings (elsewhere the terminal always uses
     * `$SHELL`).
     */
    const TERMINAL_SHELL_OPTIONS: { value: TerminalShell; label: string }[] = [
        { value: 'cmd', label: 'Command Prompt' },
        { value: 'powershell', label: 'Windows PowerShell' },
        { value: 'pwsh', label: 'PowerShell 7' },
    ]

    /**
     * Terminal → font family preset chips + custom input. The input mirrors the stored stack's primary family; it commits on Enter/blur and
     * reverts on Esc or tab switch.
     */
    const terminalFontInput = ref(primaryFontFamily(ui.terminalFontFamily))
    const terminalFontPrimary = computed(() => primaryFontFamily(ui.terminalFontFamily))
    const terminalFontMissing = computed(() => !isFontInstalled(terminalFontPrimary.value))
    function syncTerminalFontInput() {
        terminalFontInput.value = terminalFontPrimary.value
    }
    function setTerminalFontPreset(name: string) {
        ui.terminalFontFamily = buildTerminalFontFamily(name, DEFAULT_TERMINAL_FONT_FAMILY)
        terminalFontInput.value = name
    }
    function commitTerminalFontInput() {
        ui.terminalFontFamily = buildTerminalFontFamily(terminalFontInput.value, DEFAULT_TERMINAL_FONT_FAMILY)
        syncTerminalFontInput()
    }
    onMounted(syncTerminalFontInput)

    async function resetTerminal() {
        const ok = await confirmDialog({
            message: 'Reset terminal settings to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetTerminal()
        syncTerminalFontInput()
        notify('Terminal settings reset to defaults', 'success')
    }
</script>

<template>
    <div
        v-if="isWindows"
        class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-terminal
                width="13"
                height="13" />
            Shell
        </strong>
        <span
            id="terminal-shell-label"
            class="setting-label"
            >Shell for new terminals</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="terminal-shell-label">
            <button
                v-for="option in TERMINAL_SHELL_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.terminalShell === option.value }"
                :aria-pressed="ui.terminalShell === option.value"
                @click="ui.terminalShell = option.value">
                {{ option.label }}
            </button>
        </div>
        <p
            v-if="ui.terminalShell === 'pwsh'"
            class="tools-section-hint">
            PowerShell 7 falls back to Command Prompt on machines where it is not installed.
        </p>
    </div>

    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-settings-2
                width="13"
                height="13" />
            Text
        </strong>
        <span
            id="terminal-font-size-label"
            class="setting-label"
            >Font size</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="terminal-font-size-label">
            <button
                v-for="option in TERMINAL_FONT_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.terminalFontSize === option.value }"
                :aria-pressed="ui.terminalFontSize === option.value"
                @click="ui.terminalFontSize = option.value">
                {{ option.label }}
            </button>
        </div>
        <p class="tools-section-hint">
            Independent of the interface font size — the A− / A+ buttons in the terminal panel header change this too, and open terminals
            follow along.
        </p>
        <span
            id="terminal-font-family-label"
            class="setting-label"
            >Font family</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="terminal-font-family-label">
            <button
                v-for="name in TERMINAL_FONT_FAMILY_PRESETS"
                :key="name"
                type="button"
                class="setting-chip"
                :class="{ active: terminalFontPrimary === name }"
                :aria-pressed="terminalFontPrimary === name"
                @click="setTerminalFontPreset(name)">
                {{ name }}
            </button>
        </div>
        <label class="ai-field">
            <span>Custom font (must be installed on this machine)</span>
            <input
                v-model="terminalFontInput"
                type="text"
                placeholder="e.g. Fira Code"
                autocomplete="off"
                spellcheck="false"
                @keydown.enter.prevent="commitTerminalFontInput"
                @keydown.esc.stop="syncTerminalFontInput"
                @blur="commitTerminalFontInput" />
        </label>
        <p
            v-if="terminalFontMissing"
            class="tools-section-hint">
            Font not installed — using default.
        </p>
    </div>

    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-panel-top
                width="13"
                height="13" />
            Tabs
        </strong>
        <span
            id="terminal-max-tabs-label"
            class="setting-label"
            >Maximum tabs per repo</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="terminal-max-tabs-label">
            <button
                v-for="value in TERMINAL_MAX_TABS_OPTIONS"
                :key="value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.terminalMaxTabs === value }"
                :aria-pressed="ui.terminalMaxTabs === value"
                @click="ui.terminalMaxTabs = value">
                {{ value }}
            </button>
        </div>
        <p class="tools-section-hint">
            Each tab runs its own shell process. Lowering the limit keeps open shells running — it only stops new ones. Ctrl+Tab cycles
            through the tabs while the terminal panel has focus.
        </p>
    </div>

    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-maximize
                width="13"
                height="13" />
            Full window
        </strong>
        <AppCheckbox
            class="setting-toggle"
            v-model="ui.terminalFullWidth">
            Terminal covers the whole window
        </AppCheckbox>
        <span class="setting-hint">
            On: the docked strip spans all three columns, and the maximized panel (Alt+Enter) also covers the repo tab bar. Off: the strip
            floats over the Sidebar and Graph columns, and the maximized panel stays below the tab bar, clear of the Changes pane.
        </span>
    </div>

    <div class="tools-actions tools-reset-row">
        <span class="spacer" />
        <button
            class="btn danger small"
            title="Restore terminal settings to defaults"
            @click="resetTerminal()">
            <i-lucide-rotate-ccw
                width="13"
                height="13" />
            Reset to defaults
        </button>
    </div>
</template>
