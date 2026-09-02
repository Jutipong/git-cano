<script setup lang="ts">
    import Check from '~icons/lucide/check'

    import { REPO_TAB_COLOR_OPTIONS, type RepoTabColor } from '../stores/ui'

    export interface RepoTabMenuState {
        x: number
        y: number
        path: string
        name: string
        color: RepoTabColor | null
    }

    const props = defineProps<{ menu: RepoTabMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'selectColor', color: RepoTabColor | null): void
    }>()
    const root = ref<HTMLElement | null>(null)

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

    function selectColor(color: RepoTabColor | null) {
        emit('selectColor', color)
        emit('close')
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
                :class="{ active: menu.color === option.value }"
                :title="option.label"
                :aria-label="option.label"
                @click="selectColor(option.value)">
                <span
                    class="repo-tab-color-swatch"
                    :style="{ backgroundColor: option.hex }" />
                <Check
                    v-if="menu.color === option.value"
                    class="repo-tab-color-check"
                    width="12"
                    height="12" />
            </button>
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
