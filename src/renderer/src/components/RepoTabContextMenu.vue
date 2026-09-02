<script setup lang="ts">
    import Check from '~icons/lucide/check'

    import { REPO_TAB_COLOR_OPTIONS } from '../stores/ui'

    export interface RepoTabMenuState {
        x: number
        y: number
        path: string
        name: string
        color: string | null
    }

    const props = defineProps<{ menu: RepoTabMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'selectColor', color: string | null): void
    }>()
    const root = ref<HTMLElement | null>(null)
    const customHex = ref('')

    const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
    const customValid = computed(() => HEX_RE.test(customHex.value.trim()))

    watch(
        () => props.menu,
        menu => {
            if (menu) customHex.value = menu.color ?? ''
        }
    )

    function onDocMouseDown(event: MouseEvent) {
        if (props.menu && root.value && !root.value.contains(event.target as Node)) emit('close')
    }

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    onMounted(() => {
        document.addEventListener('mousedown', onDocMouseDown)
        document.addEventListener('keydown', onKey)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onDocMouseDown)
        document.removeEventListener('keydown', onKey)
    })

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.max(8, Math.min(props.menu.x, window.innerWidth - 228))}px`,
            top: `${Math.max(8, Math.min(props.menu.y, window.innerHeight - 190))}px`,
        }
    }

    function selectColor(color: string | null) {
        emit('selectColor', color)
        emit('close')
    }

    function applyCustomHex() {
        const hex = customHex.value.trim()
        if (!HEX_RE.test(hex)) return
        selectColor(hex.toLowerCase())
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="repo-tab-menu"
        :style="menuStyle()">
        <div class="repo-tab-menu-title">Tab color</div>
        <div class="repo-tab-menu-repo">{{ menu.name }}</div>
        <div class="repo-tab-color-grid">
            <button
                v-for="option in REPO_TAB_COLOR_OPTIONS"
                :key="option.value"
                type="button"
                class="repo-tab-color-option"
                :class="{ active: menu.color?.toLowerCase() === option.hex }"
                :title="option.label"
                :aria-label="option.label"
                @click="selectColor(option.hex)">
                <span
                    class="repo-tab-color-swatch"
                    :style="{ backgroundColor: option.hex }" />
                <Check
                    v-if="menu.color?.toLowerCase() === option.hex"
                    class="repo-tab-color-check"
                    width="12"
                    height="12" />
            </button>
        </div>
        <div
            class="repo-tab-color-custom"
            :class="{ invalid: customHex.trim() && !customValid }">
            <span
                class="repo-tab-color-custom-swatch"
                :style="{ backgroundColor: customValid ? customHex.trim() : 'transparent' }" />
            <input
                v-model="customHex"
                class="repo-tab-color-custom-input"
                type="text"
                spellcheck="false"
                placeholder="#rrggbb"
                title="Custom hex color"
                @keydown.enter.prevent="applyCustomHex" />
        </div>
        <button
            type="button"
            class="repo-tab-menu-clear"
            :class="{ active: !menu.color }"
            @click="selectColor(null)">
            Clear color
        </button>
    </div>
</template>
