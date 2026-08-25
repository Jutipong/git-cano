<script setup lang="ts">
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

    const draggingIndex = ref<number | null>(null)
    const dragOverEdge = ref<{ index: number; side: 'before' | 'after' } | null>(null)

    function onDragStart(index: number, e: DragEvent) {
        draggingIndex.value = index
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(index))
        }
    }

    function onDragOver(index: number, e: DragEvent) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const from = draggingIndex.value
        if (from === null) return
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
        const insertion = side === 'before' ? index : index + 1
        const to = insertion - (from < insertion ? 1 : 0)
        dragOverEdge.value = to === from ? null : { index, side }
    }

    function onDragLeave(index: number) {
        if (dragOverEdge.value?.index === index) dragOverEdge.value = null
    }

    function onDrop(index: number, e: DragEvent) {
        e.preventDefault()
        const from = draggingIndex.value
        if (from !== null) {
            const edge = dragOverEdge.value?.index === index ? dragOverEdge.value : null
            const insertion = edge ? (edge.side === 'before' ? edge.index : edge.index + 1) : index
            const to = insertion - (from < insertion ? 1 : 0)
            if (from !== to && to >= 0 && to < props.tabs.length) emit('reorder', from, to)
        }
        draggingIndex.value = null
        dragOverEdge.value = null
    }

    function onDragEnd() {
        draggingIndex.value = null
        dragOverEdge.value = null
    }
</script>

<template>
    <div
        v-if="tabs.length"
        class="tab-bar">
        <div
            v-for="(tab, index) in tabs"
            :key="tab.path"
            class="repo-tab"
            :class="{
                active: index === activeIndex,
                dragging: index === draggingIndex,
                'drop-before': dragOverEdge?.index === index && dragOverEdge.side === 'before',
                'drop-after': dragOverEdge?.index === index && dragOverEdge.side === 'after'
            }"
            :title="tab.path"
            draggable="true"
            @dragstart="onDragStart(index, $event)"
            @dragover="onDragOver(index, $event)"
            @dragleave="onDragLeave(index)"
            @drop="onDrop(index, $event)"
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
        <button
            class="icon-btn tab-new"
            title="Open another repository"
            @click="emit('open-new')">
            <i-lucide-plus
                width="15"
                height="15" />
        </button>
    </div>
</template>
