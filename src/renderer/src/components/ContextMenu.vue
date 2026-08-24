<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref } from 'vue'

    import type { MenuItem } from '@shared/types'

    export interface MenuState {
        x: number
        y: number
        items: MenuItem[]
    }

    const props = defineProps<{ menu: MenuState | null }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const root = ref<HTMLElement | null>(null)

    function onDocMouseDown(event: MouseEvent) {
        if (props.menu && root.value && !root.value.contains(event.target as Node)) emit('close')
    }
    function onDocContextMenu(event: MouseEvent) {
        if (props.menu) emit('close')
    }
    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    onMounted(() => {
        document.addEventListener('mousedown', onDocMouseDown)
        document.addEventListener('contextmenu', onDocContextMenu)
        document.addEventListener('keydown', onKey)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onDocMouseDown)
        document.removeEventListener('contextmenu', onDocContextMenu)
        document.removeEventListener('keydown', onKey)
    })

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - (props.menu.items.length + 1) * 30)}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="context-menu"
        :style="menuStyle()">
        <template
            v-for="(item, index) in menu.items"
            :key="index">
            <div
                v-if="item.separatorBefore"
                class="context-menu-separator" />
            <button
                v-else
                class="context-menu-item"
                :class="{ danger: item.danger }"
                @click="
                    () => {
                        emit('close')
                        item.action?.()
                    }
                ">
                {{ item.label }}
            </button>
        </template>
    </div>
</template>
