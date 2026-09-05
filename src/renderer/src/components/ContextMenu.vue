<script setup lang="ts">
    import VisualStudio from '~icons/catppuccin/visual-studio'
    import VisualStudioCode from '~icons/catppuccin/vscode'
    import FolderCompact from '~icons/codicon/folder-compact'
    import SquareTerminal from '~icons/hugeicons/square-terminal'
    import Rider from '~icons/logos/rider'
    import CircleCheck from '~icons/lucide/circle-check'
    import Copy from '~icons/lucide/copy'
    import GitBranch from '~icons/lucide/git-branch'
    import Pencil from '~icons/lucide/pencil'
    import Trash2 from '~icons/lucide/trash2'
    import Zap from '~icons/lucide/zap'
    import Kiro from '~icons/thesvg-color/kiro'

    import type { MenuItem } from '@shared/types'
    import type { FunctionalComponent } from 'vue'

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

    const ICONS: Record<string, FunctionalComponent> = {
        'circle-check': CircleCheck,
        'git-branch': GitBranch,
        zap: Zap,
        pencil: Pencil,
        copy: Copy,
        folder: FolderCompact,
        terminal: SquareTerminal,
        vscode: VisualStudioCode,
        kiro: Kiro,
        rider: Rider,
        visualstudio: VisualStudio,
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
            ...(props.menu.width ? { width: `${props.menu.width}px` } : {}),
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
