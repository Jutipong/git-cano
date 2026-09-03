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
                label: 'Open in Folder',
                icon: 'folder',
                action: () => run(() => window.api.openInFolder(props.path)),
            },
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
        const btn = event.currentTarget as HTMLElement
        const rect = btn.getBoundingClientRect()
        // anchor to the pill group (.tab-actions) and stretch to its width, like the other toolbar dropdowns
        const pill = btn.closest('.tab-actions')?.getBoundingClientRect()
        openInMenu.value = pill
            ? { x: pill.left, y: pill.bottom + 6, width: pill.width, items: buildItems() }
            : { x: rect.left, y: rect.bottom + 4, items: buildItems() }
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
