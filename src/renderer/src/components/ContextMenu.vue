<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, type FunctionalComponent } from 'vue'
    import TerminalSquare from '~icons/andrsrxn/terminal-square'
    import Folder from '~icons/catppuccin/folder'
    import Rider from '~icons/devicon/rider'
    import VisualStudio from '~icons/devicon/visualstudio'
    import VisualStudioCode from '~icons/devicon/vscode'
    import CircleCheck from '~icons/lucide/circle-check'
    import Copy from '~icons/lucide/copy'
    import GitBranch from '~icons/lucide/git-branch'
    import Pencil from '~icons/lucide/pencil'
    import Trash2 from '~icons/lucide/trash2'
    import Zap from '~icons/lucide/zap'
    import Kiro from '~icons/thesvg-color/kiro'

    import { useMenuKeyboard } from '../utils/menuKeyboard'

    import type { MenuItem } from '@shared/types'

    export interface MenuState {
        x: number
        y: number
        items: MenuItem[]
        /** Optional fixed width in px — toolbar dropdowns stretch to the pill group width */
        width?: number
    }

    const props = defineProps<{ menu: MenuState | null }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const root = ref<HTMLElement | null>(null)

    useMenuKeyboard({
        active: () => !!props.menu,
        container: root,
        onClose: () => emit('close'),
    })

    const ICONS: Record<string, FunctionalComponent> = {
        'circle-check': CircleCheck,
        'git-branch': GitBranch,
        zap: Zap,
        pencil: Pencil,
        copy: Copy,
        folder: Folder,
        terminal: TerminalSquare,
        vscode: VisualStudioCode,
        kiro: Kiro,
        rider: Rider,
        visualstudio: VisualStudio,
        trash: Trash2,
    }

    function onDocMouseDown(event: MouseEvent) {
        if (props.menu && root.value && !root.value.contains(event.target as Node)) emit('close')
    }
    onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - (props.menu.items.length + 1) * 30)}px`,
            ...(props.menu.width ? { width: `${props.menu.width}px` } : {}),
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="context-menu"
        role="menu"
        :style="menuStyle()">
        <template
            v-for="(item, index) in menu.items"
            :key="index">
            <div
                v-if="item.separatorBefore"
                class="context-menu-separator" />
            <button
                class="context-menu-item"
                :class="{ danger: item.danger, accent: item.accent }"
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
