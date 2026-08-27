<script setup lang="ts">
    import ContextMenu, { type MenuState } from './ContextMenu.vue'

    import type { MenuItem } from '@shared/types'

    interface Tab {
        path: string
        name: string
    }

    const props = defineProps<{ tabs: Tab[]; activeIndex: number }>()
    const emit = defineEmits<{
        (e: 'select', index: number): void
        (e: 'close', index: number): void
        (e: 'open-new'): void
        (e: 'reorder', from: number, to: number): void
    }>()

    const draggingPath = ref<string | null>(null)
    const openInMenu = ref<MenuState | null>(null)

    function buildOpenInItems(): MenuItem[] {
        const active = props.tabs[props.activeIndex]
        if (!active) return []
        const run = (fn: () => Promise<unknown>) => {
            fn().catch((error: unknown) =>
                useUiTransientStore().notify(String(error).replace(/^Error:\s*/, ''), 'error')
            )
        }
        return [
            {
                label: 'Open in Terminal',
                icon: 'terminal',
                action: () => run(() => window.api.openTerminal(active.path)),
            },
            {
                label: 'Open in VS Code',
                icon: 'vscode',
                action: () => run(() => window.api.openInVSCode(active.path)),
            },
        ]
    }

    function toggleOpenIn(event: MouseEvent) {
        if (openInMenu.value) {
            openInMenu.value = null
            return
        }
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        openInMenu.value = { x: rect.left, y: rect.bottom + 4, items: buildOpenInItems() }
    }

    function onDragStart(tab: Tab, e: DragEvent) {
        draggingPath.value = tab.path
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', tab.path)
        }
    }

    function onDragOver(index: number, e: DragEvent) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const fromPath = draggingPath.value
        if (!fromPath) return
        const from = props.tabs.findIndex(t => t.path === fromPath)
        if (from < 0) return
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
        const insertion = side === 'before' ? index : index + 1
        const to = insertion - (from < insertion ? 1 : 0)
        if (to !== from && to >= 0 && to < props.tabs.length) emit('reorder', from, to)
    }

    function onDrop(e: DragEvent) {
        e.preventDefault()
        draggingPath.value = null
    }

    function onDragEnd() {
        draggingPath.value = null
    }
</script>

<template>
    <div
        v-if="tabs.length"
        class="tab-bar">
        <TransitionGroup name="tab">
            <div
                v-for="(tab, index) in tabs"
                :key="tab.path"
                class="repo-tab"
                :class="{ active: index === activeIndex, dragging: tab.path === draggingPath }"
                :title="tab.path"
                draggable="true"
                @dragstart="onDragStart(tab, $event)"
                @dragover="onDragOver(index, $event)"
                @drop="onDrop($event)"
                @dragend="onDragEnd"
                @click="emit('select', index)">
                <span>{{ tab.name }}</span>
                <button
                    class="icon-btn danger tab-close"
                    :title="`Close ${tab.name}`"
                    @click.stop="emit('close', index)">
                    <i-lucide-x
                        width="12"
                        height="12" />
                </button>
            </div>
        </TransitionGroup>
        <button
            class="icon-btn tab-new"
            title="Open another repository"
            @click="emit('open-new')">
            <i-lucide-plus
                width="15"
                height="15" />
        </button>
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
    </div>
</template>
