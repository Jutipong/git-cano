<script setup lang="ts">
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
        <button
            class="icon-btn tab-new"
            title="Open another repository"
            @click="emit('open-new')">
            <i-lucide-plus
                width="15"
                height="15" />
        </button>
        <OpenInButton :path="activePath" />
    </div>
</template>
