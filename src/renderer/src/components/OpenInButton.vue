<script setup lang="ts">
    import ContextMenu, { type MenuState } from './ContextMenu.vue'

    import type { MenuItem } from '@shared/types'

    const props = defineProps<{ path: string }>()

    const openInMenu = ref<MenuState | null>(null)

    function buildItems(): MenuItem[] {
        const run = (fn: () => Promise<unknown>) => {
            fn().catch((error: unknown) => useUiTransientStore().notify(String(error).replace(/^Error:\s*/, ''), 'error'))
        }
        return [
            {
                label: 'Open in Terminal',
                icon: 'terminal',
                action: () => run(() => window.api.openTerminal(props.path)),
            },
            {
                label: 'Open in VS Code',
                icon: 'vscode',
                action: () => run(() => window.api.openInVSCode(props.path)),
            },
        ]
    }

    function toggleOpenIn(event: MouseEvent) {
        if (openInMenu.value) {
            openInMenu.value = null
            return
        }
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        openInMenu.value = { x: rect.left, y: rect.bottom + 4, items: buildItems() }
    }
</script>

<template>
    <button
        class="open-in-btn"
        title="Open active repository in external app"
        @click="toggleOpenIn">
        <span>Open in</span>
        <i-lucide-chevron-down
            width="12"
            height="12" />
    </button>
    <ContextMenu
        :menu="openInMenu"
        @close="openInMenu = null" />
</template>
