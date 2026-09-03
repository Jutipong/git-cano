<script setup lang="ts">
    import ArrowDown from '~icons/lucide/arrow-down'
    import ArrowDownToLine from '~icons/lucide/arrow-down-to-line'
    import ArrowUp from '~icons/lucide/arrow-up'
    import FolderGit2 from '~icons/lucide/folder-git2'
    import FolderOpen from '~icons/lucide/folder-open'
    import GitBranch from '~icons/lucide/git-branch'
    import RefreshCw from '~icons/lucide/refresh-cw'
    import Search from '~icons/lucide/search'
    import Settings from '~icons/lucide/settings'
    import X from '~icons/lucide/x'

    import { useRepoStore } from '../stores/repo'

    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import type { BranchInfo } from '@shared/types'
    import type { Component } from 'vue'

    const emit = defineEmits<{ (e: 'close'): void; (e: 'open-repo'): void }>()

    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()
    const syncStore = useSyncStore()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    type Mode = 'commands' | 'repo' | 'branch'
    const mode = ref<Mode>('commands')
    const search = ref('')
    const active = ref(0)
    const input = ref<HTMLInputElement | null>(null)
    /** Fallback branch list for the rare case the store hasn't loaded one for the active repo yet. */
    const fetchedLocal = ref<BranchInfo[] | null>(null)

    interface PaletteItem {
        id: string
        label: string
        hint?: string
        icon: Component
        run: () => void
    }

    onMounted(() => input.value?.focus())

    function close() {
        emit('close')
    }

    function enterMode(next: Mode) {
        mode.value = next
        search.value = ''
        active.value = 0
        input.value?.focus()
        if (next === 'branch' && repoStore.repo && !repoStore.branchList && !fetchedLocal.value) {
            void window.api
                .branches()
                .then(branches => (fetchedLocal.value = branches.local))
                .catch(() => {})
        }
    }

    function backToCommands() {
        enterMode('commands')
    }

    /** Closes the palette, then runs a git action (busy overlay + toasts come from the action itself). */
    function execute(action: () => Promise<unknown>) {
        close()
        void action()
    }

    function checkoutBranch(name: string) {
        close()
        void (async () => {
            try {
                await uiTransient.withBusy(async () => {
                    await window.api.checkout(name)
                    await repoStore.refresh()
                }, `Checking out ${name}…`)
                notify(`Checked out ${name}`, 'success')
            } catch (error) {
                notify(String(error).replace(/^Error:\s*/, ''), 'error')
            }
        })()
    }

    const commandItems = computed<PaletteItem[]>(() => {
        const items: PaletteItem[] = []
        if (repoStore.repo) {
            items.push(
                { id: 'pull', label: 'Pull', icon: ArrowDown, run: () => execute(() => syncStore.pull(repoStore.refresh)) },
                { id: 'push', label: 'Push', icon: ArrowUp, run: () => execute(() => syncStore.push(repoStore.refresh)) },
                { id: 'fetch', label: 'Fetch', icon: ArrowDownToLine, run: () => execute(() => syncStore.fetch(repoStore.refresh)) }
            )
        }
        items.push(
            { id: 'repo', label: 'Repo…', hint: 'Switch repository tab', icon: FolderGit2, run: () => enterMode('repo') },
            { id: 'branch', label: 'Branch…', hint: 'Checkout branch', icon: GitBranch, run: () => enterMode('branch') },
            { id: 'openRepo', label: 'Open repository', icon: FolderOpen, run: () => emit('open-repo') },
            {
                id: 'settings',
                label: 'Settings',
                icon: Settings,
                run: () => {
                    close()
                    repoStore.toolsOpen = true
                },
            }
        )
        if (repoStore.repo) {
            items.push({
                id: 'refresh',
                label: 'Refresh',
                icon: RefreshCw,
                run: () =>
                    execute(async () => {
                        await repoStore.refresh()
                        notify('Repository refreshed', 'success')
                    }),
            })
        }
        return items
    })

    const repoItems = computed<PaletteItem[]>(() =>
        repoStore.tabs.map((tab, index) => ({
            id: tab.path,
            label: tab.name,
            hint: index === repoStore.activeTab ? 'Active' : undefined,
            icon: FolderGit2,
            run: () => {
                close()
                if (index !== repoStore.activeTab) void repoStore.setActive(index)
            },
        }))
    )

    const branchItems = computed<PaletteItem[]>(() =>
        (repoStore.branchList?.local ?? fetchedLocal.value ?? [])
            .filter(branch => !branch.current && !branch.detached)
            .map(branch => ({
                id: branch.name,
                label: branch.name,
                icon: GitBranch,
                run: () => checkoutBranch(branch.name),
            }))
    )

    const items = computed<PaletteItem[]>(() =>
        mode.value === 'repo' ? repoItems.value : mode.value === 'branch' ? branchItems.value : commandItems.value
    )

    /** Like-style filter: case-insensitive substring match on the item label. */
    const filtered = computed(() => {
        const query = search.value.trim().toLowerCase()
        if (!query) return items.value
        return items.value.filter(item => item.label.toLowerCase().includes(query))
    })

    watch(filtered, () => (active.value = 0))
    watch(active, () => document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' }))

    const placeholder = computed(() =>
        mode.value === 'repo' ? 'Search repo…' : mode.value === 'branch' ? 'Search branch…' : 'Type a command…'
    )
    const emptyText = computed(() =>
        mode.value === 'repo' ? 'No matching repository' : mode.value === 'branch' ? 'No matching branch' : 'No matching command'
    )

    function move(delta: number) {
        if (!filtered.value.length) return
        active.value = (active.value + delta + filtered.value.length) % filtered.value.length
    }

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (mode.value === 'commands') close()
            else backToCommands()
        } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            move(1)
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            move(-1)
        } else if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            filtered.value[active.value]?.run()
        } else if (event.key === 'Backspace' && !search.value && mode.value !== 'commands') {
            event.preventDefault()
            event.stopPropagation()
            backToCommands()
        }
    }
</script>

<template>
    <div
        class="palette-overlay"
        @mousedown.self="close">
        <div
            class="palette"
            role="dialog"
            aria-label="Command palette">
            <div class="palette-input-row">
                <button
                    v-if="mode !== 'commands'"
                    class="palette-chip"
                    title="Back to commands"
                    @mousedown.prevent
                    @click="backToCommands">
                    <component
                        :is="mode === 'branch' ? GitBranch : FolderGit2"
                        width="11"
                        height="11" />
                    <span>{{ mode === 'branch' ? 'Branch' : 'Repo' }}</span>
                    <X
                        width="11"
                        height="11" />
                </button>
                <Search
                    v-else
                    class="palette-search-ic"
                    width="13"
                    height="13" />
                <input
                    ref="input"
                    v-model="search"
                    class="palette-input"
                    :placeholder="placeholder"
                    spellcheck="false"
                    @keydown="onKey" />
            </div>
            <div class="palette-list">
                <div
                    v-if="filtered.length === 0"
                    class="palette-empty">
                    {{ emptyText }}
                </div>
                <button
                    v-for="(item, index) in filtered"
                    :key="item.id"
                    class="palette-item"
                    :class="{ active: index === active }"
                    @mousemove="active = index"
                    @click="item.run()">
                    <component
                        :is="item.icon"
                        class="palette-ic"
                        width="14"
                        height="14" />
                    <span class="palette-label">{{ item.label }}</span>
                    <span
                        v-if="item.hint"
                        class="palette-hint"
                        >{{ item.hint }}</span
                    >
                </button>
            </div>
            <div class="palette-footer">
                <span>↑↓ navigate</span>
                <span>↵ select</span>
                <span>esc {{ mode === 'commands' ? 'close' : 'back' }}</span>
            </div>
        </div>
    </div>
</template>
