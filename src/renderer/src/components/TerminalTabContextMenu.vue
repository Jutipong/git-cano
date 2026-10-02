<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref } from 'vue'
    import Pencil from '~icons/lucide/pencil'
    import RotateCcw from '~icons/lucide/rotate-ccw'
    import Trash2 from '~icons/lucide/trash2'
    import X from '~icons/lucide/x'

    export interface TerminalTabMenuState {
        x: number
        y: number
        id: string
        /** 1-based tab number at the moment the menu opened (names hide it on the tab itself). */
        number: number
        name: string
        shell: string
        /** Whether the repo has more than one shell — decides the "Close all" item. */
        many: boolean
    }

    const props = defineProps<{ menu: TerminalTabMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'rename', id: string): void
        (e: 'reset-name', id: string): void
        (e: 'close-tab', id: string): void
        (e: 'close-all'): void
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

    /** Every action closes first — the panel's own handlers take it from there (confirm, rename…). */
    function act(kind: 'rename' | 'reset-name' | 'close-tab' | 'close-all') {
        const id = props.menu?.id
        emit('close')
        if (kind === 'close-all') emit('close-all')
        else if (kind === 'rename' && id) emit('rename', id)
        else if (kind === 'reset-name' && id) emit('reset-name', id)
        else if (kind === 'close-tab' && id) emit('close-tab', id)
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.max(8, Math.min(props.menu.x, window.innerWidth - 220))}px`,
            top: `${Math.max(8, Math.min(props.menu.y, window.innerHeight - 180))}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="terminal-tab-menu"
        :style="menuStyle()">
        <div class="terminal-tab-menu-title">Terminal {{ menu.number }} — {{ menu.shell }}</div>
        <button
            class="terminal-tab-menu-item"
            @click="act('rename')">
            <Pencil
                class="terminal-tab-menu-ic"
                width="13"
                height="13" />
            Rename…
        </button>
        <button
            v-if="menu.name"
            class="terminal-tab-menu-item"
            @click="act('reset-name')">
            <RotateCcw
                class="terminal-tab-menu-ic"
                width="13"
                height="13" />
            Reset name
        </button>
        <div class="terminal-tab-menu-separator" />
        <button
            class="terminal-tab-menu-item danger"
            @click="act('close-tab')">
            <X
                class="terminal-tab-menu-ic"
                width="13"
                height="13" />
            Close terminal
        </button>
        <button
            v-if="menu.many"
            class="terminal-tab-menu-item danger"
            @click="act('close-all')">
            <Trash2
                class="terminal-tab-menu-ic"
                width="13"
                height="13" />
            Close all terminals
        </button>
    </div>
</template>