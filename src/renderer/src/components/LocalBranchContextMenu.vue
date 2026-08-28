<script setup lang="ts">
    import ArrowDown from '~icons/lucide/arrow-down'
    import ArrowUp from '~icons/lucide/arrow-up'
    import Copy from '~icons/lucide/copy'
    import GitBranch from '~icons/lucide/git-branch'
    import Tag from '~icons/lucide/tag'
    import Trash2 from '~icons/lucide/trash2'
    import Zap from '~icons/lucide/zap'

    export interface LocalBranchMenuState {
        x: number
        y: number
        branch: { name: string; current: boolean; commitHash?: string; ahead?: number; behind?: number }
        /** repo has a configured remote to push/pull to */
        hasRemote: boolean
    }

    const props = defineProps<{ menu: LocalBranchMenuState | null }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'push', branch: LocalBranchMenuState['branch']): void
        (e: 'pull', branch: LocalBranchMenuState['branch']): void
        (e: 'forcePush', branch: LocalBranchMenuState['branch']): void
        (e: 'delete', branch: LocalBranchMenuState['branch']): void
        (e: 'createBranchHere', branch: LocalBranchMenuState['branch']): void
        (e: 'createTagHere', branch: LocalBranchMenuState['branch']): void
        (e: 'copyName', branch: LocalBranchMenuState['branch']): void
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

    function act(kind: 'push' | 'pull' | 'forcePush' | 'delete' | 'createBranchHere' | 'createTagHere' | 'copyName') {
        const branch = props.menu?.branch
        if (!branch) return
        emit('close')
        if (kind === 'push') emit('push', branch)
        else if (kind === 'pull') emit('pull', branch)
        else if (kind === 'forcePush') emit('forcePush', branch)
        else if (kind === 'delete') emit('delete', branch)
        else if (kind === 'createBranchHere') emit('createBranchHere', branch)
        else if (kind === 'createTagHere') emit('createTagHere', branch)
        else emit('copyName', branch)
    }

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.min(props.menu.x, window.innerWidth - 220)}px`,
            top: `${Math.min(props.menu.y, window.innerHeight - 7 * 34)}px`,
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="local-branch-menu"
        :style="menuStyle()">
        <button
            class="local-branch-menu-item"
            @click="act('createBranchHere')">
            <GitBranch
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Create branch here
        </button>
        <button
            class="local-branch-menu-item"
            @click="act('createTagHere')">
            <Tag
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Create tag here
        </button>
        <div class="local-branch-menu-separator" />
        <button
            class="local-branch-menu-item green"
            :disabled="!menu.hasRemote"
            @click="act('push')">
            <ArrowUp
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Push
        </button>
        <button
            class="local-branch-menu-item blue"
            :disabled="!menu.hasRemote"
            @click="act('pull')">
            <ArrowDown
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Pull
        </button>
        <div class="local-branch-menu-separator" />
        <button
            class="local-branch-menu-item orange"
            :disabled="!menu.hasRemote"
            @click="act('forcePush')">
            <Zap
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Force push
        </button>
        <button
            class="local-branch-menu-item danger"
            :disabled="menu.branch.current"
            @click="act('delete')">
            <Trash2
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Delete
        </button>
        <div class="local-branch-menu-separator" />
        <button
            class="local-branch-menu-item"
            @click="act('copyName')">
            <Copy
                class="local-branch-menu-ic"
                width="13"
                height="13" />
            Copy branch name
        </button>
    </div>
</template>