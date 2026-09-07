<script setup lang="ts">
    import ContextMenu, { type MenuState } from './ContextMenu.vue'

    import type { MenuItem, OpenInTargets } from '@shared/types'

    const props = defineProps<{ path: string }>()

    const openInMenu = ref<MenuState | null>(null)
    const targets = ref<OpenInTargets | null>(null)

    watch(
        () => props.path,
        repoPath => {
            targets.value = null
            window.api
                .getOpenInTargets(repoPath)
                .then(result => {
                    if (props.path === repoPath) targets.value = result
                })
                .catch(() => {})
        },
        { immediate: true }
    )

    function buildItems(): MenuItem[] {
        const run = (fn: () => Promise<unknown>) => {
            fn().catch((error: unknown) => useUiTransientStore().notify(String(error).replace(/^Error:\s*/, ''), 'error'))
        }
        const items: MenuItem[] = [
            {
                label: 'Folder',
                icon: 'folder',
                action: () => run(() => window.api.openInFolder(props.path)),
            },
            {
                label: 'Terminal',
                icon: 'terminal',
                action: () => run(() => window.api.openTerminal(props.path)),
            },
            {
                label: 'VS Code',
                icon: 'vscode',
                action: () => run(() => window.api.openInVSCode(props.path)),
            },
        ]
        // Shown whenever Kiro IDE is installed on the machine
        if (targets.value?.kiro) {
            items.push({
                label: 'Kiro',
                icon: 'kiro',
                action: () => run(() => window.api.openInKiro(props.path)),
            })
        }
        // C#-only entries: shown when the repo has .NET solution/project files and the IDE is installed
        if (targets.value?.visualStudio) {
            items.push({
                label: 'Visual Studio',
                icon: 'visualstudio',
                action: () => run(() => window.api.openInVisualStudio(props.path)),
            })
        }
        if (targets.value?.rider) {
            items.push({
                label: 'Rider',
                icon: 'rider',
                action: () => run(() => window.api.openInRider(props.path)),
            })
        }
        return items
    }

    function toggleOpenIn(event: MouseEvent) {
        if (openInMenu.value) {
            openInMenu.value = null
            return
        }
        const btn = event.currentTarget as HTMLElement
        const rect = btn.getBoundingClientRect()
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
