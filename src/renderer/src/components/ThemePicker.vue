<script setup lang="ts">
    import Check from '~icons/lucide/check'
    import Moon from '~icons/lucide/moon'
    import Sun from '~icons/lucide/sun'

    import { type Theme, useUiStore } from '../stores/ui'
    import type { FunctionalComponent } from 'vue'

    const ui = useUiStore()
    const root = ref<HTMLElement | null>(null)
    const open = ref(false)

    const icons: Record<string, FunctionalComponent> = { moon: Moon, sun: Sun }
    const currentTheme = computed(() => ui.themeOptions.find(option => option.value === ui.theme) ?? ui.themeOptions[0])

    function selectTheme(theme: Theme) {
        ui.setTheme(theme)
        open.value = false
    }

    function onDocumentMouseDown(event: MouseEvent) {
        if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') open.value = false
    }

    function menuStyle() {
        const rect = root.value?.getBoundingClientRect()
        if (!rect) return {}
        return {
            right: `${Math.max(8, window.innerWidth - rect.right)}px`,
            bottom: `${Math.max(8, window.innerHeight - rect.top + 8)}px`,
        }
    }

    onMounted(() => {
        document.addEventListener('mousedown', onDocumentMouseDown)
        document.addEventListener('keydown', onKeyDown)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onDocumentMouseDown)
        document.removeEventListener('keydown', onKeyDown)
    })
</script>

<template>
    <div
        ref="root"
        class="theme-picker">
        <button
            class="toolbar-icon-button"
            :title="`Theme: ${currentTheme.label}`"
            aria-label="Choose theme"
            aria-haspopup="listbox"
            :aria-expanded="open"
            @click.stop="open = !open">
            <component
                :is="icons[currentTheme.icon]"
                width="16"
                height="16" />
        </button>
        <div
            v-if="open"
            class="theme-menu"
            :style="menuStyle()"
            role="listbox"
            aria-label="Themes">
            <button
                v-for="option in ui.themeOptions"
                :key="option.value"
                class="theme-option"
                :class="{ active: ui.theme === option.value }"
                role="option"
                :aria-selected="ui.theme === option.value"
                @click="selectTheme(option.value)">
                <component
                    :is="icons[option.icon]"
                    class="theme-option-icon"
                    width="15"
                    height="15" />
                <span class="theme-option-copy">
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.description }}</small>
                </span>
                <Check
                    v-if="ui.theme === option.value"
                    class="theme-option-check"
                    width="15"
                    height="15" />
            </button>
        </div>
    </div>
</template>
