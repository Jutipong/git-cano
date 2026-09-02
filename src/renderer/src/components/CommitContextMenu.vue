<script setup lang="ts">
    import Cherry from '~icons/lucide/cherry'
    import ChevronRight from '~icons/lucide/chevron-right'
    import CircleCheck from '~icons/lucide/circle-check'
    import Copy from '~icons/lucide/copy'
    import CornerDownRight from '~icons/lucide/corner-down-right'
    import GitBranchPlus from '~icons/lucide/git-branch-plus'
    import RotateCcw from '~icons/lucide/rotate-ccw'
    import Tag from '~icons/lucide/tag'
    import Trash2 from '~icons/lucide/trash2'
    import Undo2 from '~icons/lucide/undo-2'

    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import type { CommitNode } from '@shared/types'

    export interface CommitMenuState {
        x: number
        y: number
        commit: CommitNode
    }

    const props = defineProps<{ menu: CommitMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'checkout', commit: CommitNode): void
        (e: 'create-branch', commit: CommitNode): void
        (e: 'create-tag', commit: CommitNode): void
        (e: 'cherry-pick', commit: CommitNode): void
        (e: 'revert', commit: CommitNode): void
        (e: 'reset-soft', commit: CommitNode): void
        (e: 'reset-hard', commit: CommitNode): void
    }>()

    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})
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

    type CommitAction = 'checkout' | 'create-branch' | 'create-tag' | 'cherry-pick' | 'revert' | 'reset-soft' | 'reset-hard'

    function act(kind: CommitAction) {
        const commit = props.menu?.commit
        if (!commit) return
        emit('close')
        if (kind === 'checkout') emit('checkout', commit)
        else if (kind === 'create-branch') emit('create-branch', commit)
        else if (kind === 'create-tag') emit('create-tag', commit)
        else if (kind === 'cherry-pick') emit('cherry-pick', commit)
        else if (kind === 'revert') emit('revert', commit)
        else if (kind === 'reset-soft') emit('reset-soft', commit)
        else emit('reset-hard', commit)
    }

    function copyHash() {
        const commit = props.menu?.commit
        if (!commit) return
        emit('close')
        navigator.clipboard
            .writeText(commit.hash)
            .then(() => notify('Hash copied', 'success'))
            .catch(() => notify('Copy failed', 'error'))
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 240)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - 330)}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="commit-menu"
        :style="menuStyle()">
        <button
            class="commit-menu-item green"
            @click="act('create-branch')">
            <GitBranchPlus
                class="commit-menu-ic"
                width="13"
                height="13" />
            Create branch here…
        </button>
        <button
            class="commit-menu-item purple"
            @click="act('create-tag')">
            <Tag
                class="commit-menu-ic"
                width="13"
                height="13" />
            Create tag here…
        </button>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item pink"
            @click="act('cherry-pick')">
            <Cherry
                class="commit-menu-ic"
                width="13"
                height="13" />
            Cherry-pick onto HEAD
        </button>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item blue"
            @click="act('checkout')">
            <CornerDownRight
                class="commit-menu-ic"
                width="13"
                height="13" />
            Checkout {{ menu.commit.shortHash }}
        </button>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item orange"
            @click="act('revert')">
            <Undo2
                class="commit-menu-ic"
                width="13"
                height="13" />
            Revert this commit
        </button>
        <div class="commit-menu-wrap">
            <button class="commit-menu-item orange has-sub">
                <RotateCcw
                    class="commit-menu-ic"
                    width="13"
                    height="13" />
                Revert main to this commit
                <ChevronRight
                    class="commit-menu-chev"
                    width="12"
                    height="12" />
            </button>
            <div class="commit-menu-sub">
                <button
                    class="commit-menu-item orange"
                    @click="act('reset-soft')">
                    <CircleCheck
                        class="commit-menu-ic"
                        width="13"
                        height="13" />
                    Soft — keep all changes
                </button>
                <button
                    class="commit-menu-item danger"
                    @click="act('reset-hard')">
                    <Trash2
                        class="commit-menu-ic"
                        width="13"
                        height="13" />
                    Hard — discard all changes
                </button>
            </div>
        </div>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item"
            @click="copyHash">
            <Copy
                class="commit-menu-ic"
                width="13"
                height="13" />
            Copy hash
        </button>
    </div>
</template>
