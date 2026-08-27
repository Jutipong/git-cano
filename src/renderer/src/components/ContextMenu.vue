<script setup lang="ts">
    import CircleCheck from '~icons/lucide/circle-check'
    import Copy from '~icons/lucide/copy'
    import Pencil from '~icons/lucide/pencil'
    import SquareTerminal from '~icons/lucide/square-terminal'
    import Trash2 from '~icons/lucide/trash2'
    import Zap from '~icons/lucide/zap'
    import VisualStudioCode from '~icons/simple-icons/visualstudiocode'

    import type { MenuItem } from '@shared/types'
    import type { FunctionalComponent } from 'vue'

    export interface MenuState {
        x: number
        y: number
        items: MenuItem[]
    }

    const props = defineProps<{ menu: MenuState | null }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const root = ref<HTMLElement | null>(null)

    /* registry of icons usable by menu items (referenced by key in MenuItem.icon) */
    const ICONS: Record<string, FunctionalComponent> = {
        'circle-check': CircleCheck,
        zap: Zap,
        pencil: Pencil,
        copy: Copy,
        terminal: SquareTerminal,
        vscode: VisualStudioCode,
        trash: Trash2,
    }

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
                class="context-menu-item"
                :class="{ danger: item.danger, green: item.tone === 'green', orange: item.tone === 'orange' }"
                @click="
                    () => {
                        emit('close')
                        item.action?.()
                    }
                ">
                <component
                    :is="ICONS[item.icon]"
                    v-if="item.icon && ICONS[item.icon]"
                    class="menu-ic"
                    :class="`menu-ic-${item.icon}`"
                    width="13"
                    height="13" />
                {{ item.label }}
            </button>
        </template>
    </div>
</template>
