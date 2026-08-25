<script setup lang="ts">
    import type { StashEntry } from '@shared/types'

    import CircleCheck from '~icons/lucide/circle-check'
    import Copy from '~icons/lucide/copy'
    import Pencil from '~icons/lucide/pencil'
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
        (e: 'rename', stash: StashEntry): void
        (e: 'duplicate', stash: StashEntry): void
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

    function act(kind: 'apply' | 'pop' | 'rename' | 'duplicate') {
        const stash = props.menu?.stash
        if (!stash) return
        emit('close')
        if (kind === 'apply') emit('apply', stash)
        else if (kind === 'pop') emit('pop', stash)
        else if (kind === 'rename') emit('rename', stash)
        else emit('duplicate', stash)
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - 5 * 34)}px`,
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
            <CircleCheck
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
            class="stash-menu-item"
            @click="act('rename')">
            <Pencil
                class="stash-menu-ic"
                width="13"
                height="13" />
            Rename…
        </button>
        <button
            class="stash-menu-item"
            @click="act('duplicate')">
            <Copy
                class="stash-menu-ic"
                width="13"
                height="13" />
            Duplicate…
        </button>
    </div>
</template>
