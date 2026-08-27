<script setup lang="ts">
    import type { StashEntry } from '@shared/types'

    import Download from '~icons/lucide/download'
    import Trash2 from '~icons/lucide/trash2'
    import Zap from '~icons/lucide/zap'

    export interface StashMenuState {
        x: number
        y: number
        stash: StashEntry
    }

    const props = defineProps<{ menu: StashMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'apply', stash: StashEntry): void
        (e: 'pop', stash: StashEntry): void
        (e: 'drop', stash: StashEntry): void
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

    function act(kind: 'apply' | 'pop' | 'drop') {
        const stash = props.menu?.stash
        if (!stash) return
        emit('close')
        if (kind === 'apply') emit('apply', stash)
        else if (kind === 'pop') emit('pop', stash)
        else emit('drop', stash)
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - 3 * 34)}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="stash-menu"
        :style="menuStyle()">
        <button
            class="stash-menu-item green"
            @click="act('apply')">
            <Download
                class="stash-menu-ic"
                width="13"
                height="13" />
            Apply
        </button>
        <button
            class="stash-menu-item orange"
            @click="act('pop')">
            <Zap
                class="stash-menu-ic"
                width="13"
                height="13" />
            Pop
        </button>
        <div class="stash-menu-separator" />
        <button
            class="stash-menu-item danger"
            @click="act('drop')">
            <Trash2
                class="stash-menu-ic"
                width="13"
                height="13" />
            Drop
        </button>
    </div>
</template>
