<script setup lang="ts">
    import Copy from '~icons/lucide/copy'
    import Trash2 from '~icons/lucide/trash2'
    import CloudUpload from '~icons/lucide/cloud-upload'

    export interface TagMenuState {
        x: number
        y: number
        tag: { name: string; hash: string }
        onRemote: boolean
        canPush: boolean
    }

    const props = defineProps<{ menu: TagMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'copyName', tag: { name: string; hash: string }): void
        (e: 'delete', tag: { name: string; hash: string }): void
        (e: 'push', tag: { name: string; hash: string }): void
        (e: 'deleteRemote', tag: { name: string; hash: string }): void
    }>()
    const root = ref<HTMLElement | null>(null)

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

    function act(kind: 'copyName' | 'delete' | 'push' | 'deleteRemote') {
        const tag = props.menu?.tag
        if (!tag) return
        emit('close')
        if (kind === 'copyName') emit('copyName', tag)
        else if (kind === 'delete') emit('delete', tag)
        else if (kind === 'push') emit('push', tag)
        else emit('deleteRemote', tag)
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - 6 * 34)}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="tag-menu"
        :style="menuStyle()">
        <button
            v-if="menu && !menu.onRemote && menu.canPush"
            class="tag-menu-item push"
            @click="act('push')">
            <CloudUpload
                class="tag-menu-ic"
                width="13"
                height="13" />
            Push to remote
        </button>
        <div
            v-if="menu && !menu.onRemote && menu.canPush"
            class="tag-menu-separator" />
        <button
            v-if="menu && menu.onRemote"
            class="tag-menu-item danger"
            @click="act('deleteRemote')">
            <Trash2
                class="tag-menu-ic"
                width="13"
                height="13" />
            Delete remote
        </button>
        <button
            class="tag-menu-item danger"
            @click="act('delete')">
            <Trash2
                class="tag-menu-ic"
                width="13"
                height="13" />
            Delete
        </button>
        <div class="tag-menu-separator" />
        <button
            class="tag-menu-item"
            @click="act('copyName')">
            <Copy
                class="tag-menu-ic"
                width="13"
                height="13" />
            Copy tag name
        </button>
    </div>
</template>