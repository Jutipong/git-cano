<script setup lang="ts">
    import { computed, inject } from 'vue'
    import Moon from '~icons/lucide/moon'
    import ILucidePalette from '~icons/lucide/palette'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import Sun from '~icons/lucide/sun'

    import { FONT_SIZE_OPTIONS, useUiStore, type ThemeOption } from '../../stores/ui'
    import { confirmDialog } from '../../utils/confirm'

    import type { ToastKind } from '../../stores/uiTransient'

    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const ui = useUiStore()

    /** Appearance → Font size chips (px labels). */
    const FONT_OPTIONS = FONT_SIZE_OPTIONS.map(value => ({ value, label: `${value}px` }))
    const themeIcon = (option: ThemeOption) => (option.icon === 'sun' ? Sun : Moon)
    const darkThemeOptions = computed(() => ui.themeOptions.filter(option => option.kind === 'dark' && !option.value.startsWith('win9x')))
    const lightThemeOptions = computed(() => ui.themeOptions.filter(option => option.kind === 'light' && !option.value.startsWith('win9x')))
    const win9xThemeOptions = computed(() => ui.themeOptions.filter(option => option.value.startsWith('win9x')))

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
</script>

<template>
    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-palette
                width="13"
                height="13" />
            Appearance
        </strong>
        <span
            id="theme-label"
            class="setting-label"
            >Theme</span
        >
        <div
            class="theme-rows"
            role="group"
            aria-labelledby="theme-label">
            <div class="setting-choice-row">
                <button
                    v-for="option in darkThemeOptions"
                    :key="option.value"
                    type="button"
                    class="setting-chip"
                    :class="{ active: ui.theme === option.value }"
                    :aria-pressed="ui.theme === option.value"
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
                    :aria-pressed="ui.theme === option.value"
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
                    v-for="option in win9xThemeOptions"
                    :key="option.value"
                    type="button"
                    class="setting-chip"
                    :class="{ active: ui.theme === option.value }"
                    :aria-pressed="ui.theme === option.value"
                    @click="ui.setTheme(option.value)">
                    <component
                        :is="themeIcon(option)"
                        width="13"
                        height="13" />
                    {{ option.label }}
                </button>
            </div>
        </div>
        <span
            id="appearance-font-size-label"
            class="setting-label"
            >Font size</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="appearance-font-size-label">
            <button
                v-for="option in FONT_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.fontSize === option.value }"
                :aria-pressed="ui.fontSize === option.value"
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
