<script setup lang="ts">
    import { nextTick } from 'vue'

    import OpenInButton from './OpenInButton.vue'

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
    const activePath = computed(() => props.tabs[props.activeIndex]?.path ?? '')

    // repo search: click the 🔍 button → an input expands in the pill, matching
    // open tabs (case-insensitive substring) show in a dropdown below
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
        // clicks inside the actions pill (incl. the toggle button) are handled
        // by their own handlers — anything outside closes the search
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
        <div class="tab-actions">
            <button
                class="icon-btn tab-search"
                :class="{ open: searchOpen }"
                title="Search open repositories"
                @click="toggleSearch">
                <i-lucide-search
                    width="15"
                    height="15" />
            </button>
            <input
                v-if="searchOpen"
                ref="searchInput"
                v-model="searchQuery"
                class="tab-search-input"
                type="text"
                placeholder="Search open repos…"
                @keydown="onSearchKeydown" />
            <span class="tab-actions-sep" />
            <OpenInButton :path="activePath" />
            <span class="tab-actions-sep" />
            <button
                class="icon-btn tab-new"
                title="Open another repository"
                @click="emit('open-new')">
                <i-lucide-plus
                    width="15"
                    height="15" />
            </button>
            <div
                v-if="searchOpen"
                class="tab-search-pop">
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
        </div>
    </div>
</template>
