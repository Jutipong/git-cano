<script setup lang="ts">
    import { nextTick } from 'vue'

    import OpenInButton from './OpenInButton.vue'
    import WorkspaceButton from './WorkspaceButton.vue'

    import type { RepoStatus } from '@shared/types'
    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'

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
        (e: 'open-new'): void
        (e: 'reorder', from: number, to: number): void
        (e: 'create-stash'): void
    }>()

    const draggingPath = ref<string | null>(null)
    const activePath = computed(() => props.tabs[props.activeIndex]?.path ?? '')

    const uiTransient = useUiTransientStore()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const syncBusy = ref<string | null>(null)

    function actFetch() {
        void sync('Fetch', () => window.api.fetch(), 'Fetch completed')
    }

    function actPull() {
        void sync('Pull', () => window.api.pull(), 'Pull completed')
    }

    function actPush() {
        void sync('Push', () => window.api.push(), 'Push completed')
    }

    async function sync(label: string, fn: () => Promise<unknown>, ok: string) {
        if (syncBusy.value) return
        syncBusy.value = label
        try {
            await uiTransient.withBusy(fn, `${label}ing…`)
            await props.refresh()
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            syncBusy.value = null
        }
    }

    const searchOpen = ref(false)
    const searchQuery = ref('')
    const searchInput = ref<HTMLInputElement | null>(null)

    const searchResults = computed(() => {
        const query = searchQuery.value.trim().toLowerCase()
        return props.tabs
            .map((tab, index) => ({ tab, index }))
            .filter(({ tab }) => tab.name.toLowerCase().includes(query))
            .slice(0, 6)
    })

    function toggleSearch() {
        if (searchOpen.value) {
            closeSearch()
            return
        }
        searchOpen.value = true
        nextTick(() => searchInput.value?.focus())
    }

    function closeSearch() {
        searchOpen.value = false
        searchQuery.value = ''
    }

    function pickResult(index: number) {
        emit('select', index)
        closeSearch()
    }

    function onSearchKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation()
            closeSearch()
        } else if (event.key === 'Enter' && searchResults.value.length) {
            pickResult(searchResults.value[0].index)
        }
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!searchOpen.value) return
        if ((event.target as HTMLElement | null)?.closest('.tab-actions')) return
        closeSearch()
    }

    onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
    onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))

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
        <div
            class="tab-actions"
            :class="{ 'search-open': searchOpen }">
            <template v-if="searchOpen">
                <div class="tab-search-field">
                    <i-lucide-search
                        width="15"
                        height="15" />
                    <input
                        ref="searchInput"
                        v-model="searchQuery"
                        class="tab-search-input"
                        type="text"
                        placeholder="Search open repos…"
                        @keydown="onSearchKeydown" />
                    <button
                        v-if="searchQuery"
                        type="button"
                        class="search-clear"
                        aria-label="Clear repository search"
                        @click="searchQuery = ''">
                        ×
                    </button>
                </div>
                <div class="tab-search-pop">
                    <button
                        v-for="{ tab, index } in searchResults"
                        :key="tab.path"
                        class="tab-search-result"
                        :class="{ active: index === activeIndex }"
                        :title="tab.path"
                        @click="pickResult(index)">
                        <span class="tab-search-result-name">{{ tab.name }}</span>
                    </button>
                    <div
                        v-if="!searchResults.length"
                        class="tab-search-empty">
                        No matching repository
                    </div>
                </div>
            </template>
            <template v-else>
                <WorkspaceButton />
                <span class="tab-actions-sep" />
                <OpenInButton :path="activePath" />
                <span class="tab-actions-sep" />
                <button
                    class="icon-btn tab-search"
                    title="Search open repositories"
                    @click="toggleSearch">
                    <i-lucide-search
                        width="15"
                        height="15" />
                </button>
                <span class="tab-actions-sep" />
                <button
                    class="icon-btn tab-new"
                    title="Open another repository"
                    @click="emit('open-new')">
                    <i-lucide-plus
                        width="15"
                        height="15" />
                </button>
            </template>
        </div>
        <div class="tab-group">
            <div class="tab-scroll">
                <TransitionGroup
                    name="tab"
                    tag="div"
                    class="tab-track">
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
                            class="icon-btn danger commit-close-btn tab-close"
                            :title="`Close ${tab.name}`"
                            @click.stop="emit('close', index)">
                            <i-lucide-x
                                width="12"
                                height="12" />
                        </button>
                    </div>
                </TransitionGroup>
            </div>
        </div>
        <div class="tab-sync-actions">
            <button
                class="toolbar-action primary-action"
                :disabled="!!syncBusy || !repo"
                title="Push"
                @click="actPush()">
                <i-lucide-arrow-up
                    :class="{ 'bouncing-up': syncBusy === 'Push' }"
                    width="15"
                    height="15" />
                <span>Push</span>
                <span
                    v-if="repo?.ahead"
                    class="sync-count">{{ repo.ahead }}</span>
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-pull"
                :disabled="!!syncBusy || !repo"
                title="Pull"
                @click="actPull()">
                <i-lucide-arrow-down
                    :class="{ 'bouncing-down': syncBusy === 'Pull' }"
                    width="15"
                    height="15" />
                <span>Pull</span>
                <span
                    v-if="repo?.behind"
                    class="sync-count">{{ repo.behind }}</span>
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-fetch"
                :disabled="!!syncBusy || !repo"
                title="Fetch"
                @click="actFetch()">
                <i-lucide-refresh-cw
                    :class="{ spinning: syncBusy === 'Fetch' }"
                    width="15"
                    height="15" />
                <span>Fetch</span>
            </button>
            <span class="tab-actions-sep" />
            <button
                class="toolbar-action action-stash"
                :disabled="!repo || !repo.files.length"
                :title="repo?.files.length ? 'Stashes' : 'No changes to stash'"
                @click="emit('create-stash')">
                <i-lucide-archive
                    width="15"
                    height="15" />
                <span>Stashes</span>
            </button>
        </div>
    </div>
</template>
