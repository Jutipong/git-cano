<script setup lang="ts">
    import { nextTick, computed, ref } from 'vue'
    import ILucideArrowDown from '~icons/lucide/arrow-down'
    import ILucideArrowUp from '~icons/lucide/arrow-up'

    import { useRepoStore } from '../stores/repo'
    import { useSyncStore } from '../stores/sync'
    import { useUiStore } from '../stores/ui'
    import { formatCombo } from '../utils/shortcuts'
    import CloseXIcon from './CloseXIcon.vue'
    import OpenInButton from './OpenInButton.vue'
    import OpenRepoMenu from './OpenRepoMenu.vue'
    import RepoTabContextMenu, { type RepoTabMenuState } from './RepoTabContextMenu.vue'
    import ThinkSpinner from './ThinkSpinner.vue'
    import WorkspaceButton from './WorkspaceButton.vue'

    import type { RepoStatus } from '@shared/types'

    interface Tab {
        path: string
        name: string
    }

    const props = defineProps<{
        tabs: Tab[]
        activeIndex: number
        repo: RepoStatus | null
        refresh: () => Promise<unknown>
    }>()
    const emit = defineEmits<{
        (e: 'select', index: number): void
        (e: 'close', index: number): void
        (e: 'reorder', from: number, to: number): void
        (e: 'create-stash'): void
        (e: 'clone'): void
    }>()

    const draggingPath = ref<string | null>(null)
    const activePath = computed(() => props.tabs[props.activeIndex]?.path ?? '')

    function focusTab(index: number) {
        document.querySelectorAll<HTMLElement>('.tab-track .repo-tab')[index]?.focus()
    }

    function onTabKeydown(event: KeyboardEvent, index: number) {
        const count = props.tabs.length
        if (!count) return
        let next = index
        if (event.key === 'ArrowLeft') next = (index - 1 + count) % count
        else if (event.key === 'ArrowRight') next = (index + 1) % count
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = count - 1
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            emit('select', index)
            return
        } else return
        event.preventDefault()
        emit('select', next)
        void nextTick(() => focusTab(next))
    }

    const ui = useUiStore()

    const syncStore = useSyncStore()
    const repoStore = useRepoStore()
    const syncBusy = computed(() => syncStore.busy)

    function actFetch() {
        void syncStore.fetch(repoStore.refreshWithTags)
    }

    function actPull() {
        void syncStore.pull(repoStore.refreshWithTags)
    }

    function actPush() {
        void syncStore.push(props.refresh)
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

    const tabMenu = ref<RepoTabMenuState | null>(null)

    function openTabMenu(tab: Tab, event: MouseEvent) {
        tabMenu.value = {
            x: event.clientX,
            y: event.clientY,
            path: tab.path,
            name: tab.name,
            color: ui.repoTabColors[tab.path] ?? null,
        }
    }

    function setTabColor(color: RepoTabMenuState['color']) {
        const path = tabMenu.value?.path
        if (!path) return
        ui.setRepoTabColor(path, color)
    }

    function tabColorHex(path: string) {
        return ui.repoTabColors[path]
    }
</script>

<template>
    <div
        v-if="tabs.length"
        class="tab-bar">
        <div class="tab-actions">
            <WorkspaceButton />
            <span class="tab-actions-sep" />
            <OpenInButton :path="activePath" />
            <span class="tab-actions-sep" />
            <OpenRepoMenu @clone="emit('clone')" />
        </div>
        <div class="tab-group">
            <div class="tab-scroll">
                <TransitionGroup
                    name="tab"
                    tag="div"
                    class="tab-track"
                    role="tablist"
                    aria-label="Open repositories">
                    <div
                        v-for="(tab, index) in tabs"
                        :key="tab.path"
                        class="repo-tab"
                        :class="{ active: index === activeIndex, dragging: tab.path === draggingPath }"
                        :title="tab.path"
                        role="tab"
                        :aria-selected="index === activeIndex"
                        :tabindex="index === activeIndex ? 0 : -1"
                        draggable="true"
                        @dragstart="onDragStart(tab, $event)"
                        @dragover="onDragOver(index, $event)"
                        @drop="onDrop($event)"
                        @dragend="onDragEnd"
                        @contextmenu.prevent.stop="openTabMenu(tab, $event)"
                        @click="emit('select', index)"
                        @keydown="onTabKeydown($event, index)">
                        <span
                            v-if="ui.repoTabColors[tab.path]"
                            class="repo-tab-color-dot"
                            :style="{ backgroundColor: tabColorHex(tab.path) }"
                            aria-hidden="true" />
                        <span class="repo-tab-name">{{ tab.name }}</span>
                        <button
                            class="icon-btn danger commit-close-btn tab-close"
                            tabindex="-1"
                            :title="`Close ${tab.name}`"
                            :aria-label="`Close ${tab.name}`"
                            @click.stop="emit('close', index)">
                            <CloseXIcon />
                        </button>
                    </div>
                </TransitionGroup>
            </div>
        </div>
        <RepoTabContextMenu
            :menu="tabMenu"
            @close="tabMenu = null"
            @select-color="setTabColor" />
        <div class="tab-sync-actions">
            <button
                class="toolbar-action primary-action"
                :disabled="!!syncBusy || !repo"
                :title="`Push (${formatCombo(ui.getShortcut('push'))})`"
                @click="actPush()">
                <ThinkSpinner
                    v-if="syncBusy === 'Push'"
                    compact />
                <i-lucide-arrow-up
                    v-else
                    width="15"
                    height="15" />
                <span>Push</span>
                <span
                    v-if="repo?.ahead"
                    class="sync-count"
                    >{{ repo.ahead }}</span
                >
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-pull"
                :disabled="!!syncBusy || !repo"
                :title="`Pull (${formatCombo(ui.getShortcut('pull'))})`"
                @click="actPull()">
                <ThinkSpinner
                    v-if="syncBusy === 'Pull'"
                    compact />
                <i-lucide-arrow-down
                    v-else
                    width="15"
                    height="15" />
                <span>Pull</span>
                <span
                    v-if="repo?.behind"
                    class="sync-count"
                    >{{ repo.behind }}</span
                >
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-fetch"
                :disabled="!!syncBusy || !repo"
                :title="`Fetch (${formatCombo(ui.getShortcut('fetch'))})`"
                @click="actFetch()">
                <ThinkSpinner
                    v-if="syncBusy === 'Fetch'"
                    compact />
                <span>Fetch</span>
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-stash"
                :disabled="!repo || !repo.files.length"
                :title="repo?.files.length ? 'Stashes' : 'No changes to stash'"
                @click="emit('create-stash')">
                <span>Stashes</span>
            </button>
        </div>
    </div>
</template>
