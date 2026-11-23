<script setup lang="ts">
    import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import Cherry from '~icons/lucide/cherry'
    import ChevronRight from '~icons/lucide/chevron-right'
    import CircleCheck from '~icons/lucide/circle-check'
    import Combine from '~icons/lucide/combine'
    import Copy from '~icons/lucide/copy'
    import CornerDownRight from '~icons/lucide/corner-down-right'
    import GitBranch from '~icons/lucide/git-branch'
    import GitBranchPlus from '~icons/lucide/git-branch-plus'
    import Globe2 from '~icons/lucide/globe2'
    import RotateCcw from '~icons/lucide/rotate-ccw'
    import Tag from '~icons/lucide/tag'
    import Trash2 from '~icons/lucide/trash2'
    import Undo2 from '~icons/lucide/undo-2'

    import { useMenuKeyboard } from '../utils/menuKeyboard'

    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import type { CommitNode } from '@shared/types'

    /** A branch pointing at the menu's commit — listed as its own `Checkout <branch>` item. */
    export interface CommitBranchOption {
        kind: 'local' | 'remote'
        /** Local branch name shown in the menu and checked out for both kinds. */
        name: string
        /** Full remote ref (`origin/dev`) — only for remote targets. */
        remoteRef?: string
    }

    export interface CommitMenuState {
        x: number
        y: number
        commit: CommitNode
        squashCount?: number
        /** Branches at the commit, local first; remote-only entries create/track the local branch. */
        checkoutBranches?: CommitBranchOption[]
    }

    const props = defineProps<{ menu: CommitMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'checkout', commit: CommitNode): void
        (e: 'checkout-branch', branch: CommitBranchOption): void
        (e: 'create-branch', commit: CommitNode): void
        (e: 'create-tag', commit: CommitNode): void
        (e: 'cherry-pick', commit: CommitNode): void
        (e: 'squash', commit: CommitNode): void
        (e: 'revert', commit: CommitNode): void
        (e: 'reset-soft', commit: CommitNode): void
        (e: 'reset-hard', commit: CommitNode): void
    }>()

    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})
    const root = ref<HTMLElement | null>(null)
    const submenuOpen = ref(false)

    function close() {
        submenuOpen.value = false
        emit('close')
    }

    function focusSubmenuTrigger() {
        void nextTick(() => root.value?.querySelector<HTMLElement>('.commit-menu-wrap > .has-sub')?.focus())
    }

    function focusSubmenuFirst() {
        void nextTick(() => root.value?.querySelector<HTMLElement>('.commit-menu-sub button')?.focus())
    }

    useMenuKeyboard({
        active: () => !!props.menu,
        container: root,
        onClose: close,
        onEscape: () => {
            if (!submenuOpen.value) return false
            submenuOpen.value = false
            focusSubmenuTrigger()
            return true
        },
        onArrowRight: item => {
            if (!item.classList.contains('has-sub')) return false
            submenuOpen.value = true
            focusSubmenuFirst()
            return true
        },
        onArrowLeft: () => {
            if (!submenuOpen.value) return false
            submenuOpen.value = false
            focusSubmenuTrigger()
            return true
        },
    })

    watch(
        () => props.menu,
        current => {
            if (!current) submenuOpen.value = false
        }
    )

    function onDocMouseDown(event: MouseEvent) {
        if (props.menu && root.value && !root.value.contains(event.target as Node)) emit('close')
    }

    onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

    type CommitAction = 'create-branch' | 'create-tag' | 'cherry-pick' | 'squash' | 'revert' | 'reset-soft' | 'reset-hard'

    function act(kind: CommitAction) {
        const commit = props.menu?.commit
        if (!commit) return
        emit('close')
        if (kind === 'create-branch') emit('create-branch', commit)
        else if (kind === 'create-tag') emit('create-tag', commit)
        else if (kind === 'cherry-pick') emit('cherry-pick', commit)
        else if (kind === 'squash') emit('squash', commit)
        else if (kind === 'revert') emit('revert', commit)
        else if (kind === 'reset-soft') emit('reset-soft', commit)
        else emit('reset-hard', commit)
    }

    /** The raw-commit checkout item keeps detached-HEAD inspection available when the menu also lists branches. */
    function checkoutCommitItem() {
        const commit = props.menu?.commit
        if (!commit) return
        emit('close')
        emit('checkout', commit)
    }

    function checkoutBranch(branch: CommitBranchOption) {
        emit('close')
        emit('checkout-branch', branch)
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
        // Branch rows grow the menu — keep the top clamp in step so it never opens past the bottom edge.
        const height = 330 + (props.menu.checkoutBranches?.length ?? 0) * 29
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 240)}px`,
            top: `${Math.max(8, Math.min(props.menu.y, window.innerHeight - height))}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="commit-menu"
        role="menu"
        :style="menuStyle()">
        <button
            class="commit-menu-item"
            @click="act('create-branch')">
            <GitBranchPlus
                class="commit-menu-ic"
                width="13"
                height="13" />
            Create branch
        </button>
        <button
            class="commit-menu-item"
            @click="act('create-tag')">
            <Tag
                class="commit-menu-ic"
                width="13"
                height="13" />
            Create tag
        </button>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item"
            @click="act('cherry-pick')">
            <Cherry
                class="commit-menu-ic"
                width="13"
                height="13" />
            Cherry-pick onto HEAD
        </button>
        <button
            v-if="(menu.squashCount ?? 0) >= 2"
            class="commit-menu-item"
            @click="act('squash')">
            <Combine
                class="commit-menu-ic"
                width="13"
                height="13" />
            Squash {{ menu.squashCount }} commits…
        </button>
        <div class="commit-menu-separator" />
        <button
            v-for="branch in menu.checkoutBranches ?? []"
            :key="`${branch.kind}:${branch.name}`"
            class="commit-menu-item"
            :title="branch.kind === 'remote' ? `Track ${branch.remoteRef}` : ''"
            @click="checkoutBranch(branch)">
            <GitBranch
                v-if="branch.kind === 'local'"
                class="commit-menu-ic"
                width="13"
                height="13" />
            <Globe2
                v-else
                class="commit-menu-ic"
                width="13"
                height="13" />
            Checkout {{ branch.name }}<template v-if="branch.kind === 'remote'"> (track {{ branch.remoteRef }})</template>
        </button>
        <button
            class="commit-menu-item"
            @click="checkoutCommitItem">
            <CornerDownRight
                class="commit-menu-ic"
                width="13"
                height="13" />
            Checkout {{ menu.commit.shortHash }}
        </button>
        <div class="commit-menu-separator" />
        <button
            class="commit-menu-item"
            @click="act('revert')">
            <Undo2
                class="commit-menu-ic"
                width="13"
                height="13" />
            Revert this commit
        </button>
        <div
            class="commit-menu-wrap"
            :class="{ 'keyboard-open': submenuOpen }">
            <button
                class="commit-menu-item has-sub"
                aria-haspopup="menu"
                :aria-expanded="submenuOpen">
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
            <div
                class="commit-menu-sub"
                role="menu"
                aria-label="Reset options">
                <button
                    class="commit-menu-item"
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
