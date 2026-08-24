<script setup lang="ts">
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'
    import RemoteManager from './RemoteManager.vue'
    import StashPanel from './StashPanel.vue'

    import type { MenuItem, RepoStatus } from '@shared/types'

    const props = defineProps<{ repo: RepoStatus; refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string) => void>('notify', () => {})
    const emit = defineEmits<{ (e: 'interactive-rebase', baseRef: string): void }>()

    const ui = useUiStore()
    const repoStore = useRepoStore()
    const local = ref<{ name: string; current: boolean; ahead?: number; behind?: number }[]>([])
    const remote = ref<{ name: string; current: boolean }[]>([])
    const tags = ref<{ name: string; hash: string }[]>([])
    const showNew = ref(false)
    const localExpanded = computed({
        get: () => ui.sidebarSections.local,
        set: value => {
            ui.sidebarSections.local = value
        },
    })
    const tagsExpanded = computed({
        get: () => ui.sidebarSections.tags,
        set: value => {
            ui.sidebarSections.tags = value
        },
    })
    const remoteExpanded = computed({
        get: () => ui.sidebarSections.remote,
        set: value => {
            ui.sidebarSections.remote = value
        },
    })
    const newName = ref('')
    const menu = ref<MenuState | null>(null)
    const dropTarget = ref<string | null>(null)
    const showRemoteManager = ref(false)

    async function loadAll() {
        try {
            const branches = await window.api.branches()
            local.value = branches.local
            remote.value = branches.remote
        } catch {
            /* ignore */
        }
        try {
            tags.value = await window.api.tags()
        } catch {
            /* ignore */
        }
    }

    watch(() => props.repo, loadAll, { immediate: true })

    function actStash() {
        const message = window.prompt('Stash message:', 'WIP')
        if (message === null) return
        void run(() => window.api.createStash(message.trim() || 'WIP', true), 'Stashed changes')
    }

    async function run(fn: () => Promise<unknown>, ok: string) {
        try {
            await fn()
            await props.refresh()
            await loadAll()
            notify(ok)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function buildBranchMenu(branch: { name: string; current: boolean }): MenuItem[] {
        const items: MenuItem[] = []
        if (!branch.current) {
            items.push({
                label: `Checkout ${branch.name}`,
                action: () => void run(() => window.api.checkout(branch.name), `Checked out ${branch.name}`),
            })
            items.push({
                label: 'Merge into HEAD',
                action: () => void run(() => window.api.mergeBranch(branch.name), `Merged ${branch.name}`),
            })
            items.push({
                label: 'Rebase onto this branch',
                action: () => void run(() => window.api.rebaseOnto(branch.name), `Rebased onto ${branch.name}`),
            })
        }
        items.push({
            label: 'Rename…',
            separatorBefore: true,
            action: () => {
                const next = window.prompt(`Rename branch "${branch.name}" to:`, branch.name)
                if (next && next !== branch.name) void run(() => window.api.renameBranch(branch.name, next.trim()), 'Branch renamed')
            },
        })
        if (!branch.current) {
            items.push({
                label: 'Interactive rebase onto this branch…',
                separatorBefore: true,
                action: () => emit('interactive-rebase', branch.name),
            })
            items.push({
                label: `Delete ${branch.name}`,
                danger: true,
                separatorBefore: true,
                action: () => {
                    if (window.confirm(`Delete branch "${branch.name}"?`))
                        void run(() => window.api.deleteBranch(branch.name), `Deleted ${branch.name}`)
                },
            })
        }
        return items
    }

    function checkoutBranch(name: string) {
        void run(() => window.api.checkout(name), `Checked out ${name}`)
    }
    function mergeBranchIntoHead(name: string) {
        void run(() => window.api.mergeBranch(name), `Merged ${name}`)
    }
    function checkoutRemote(name: string) {
        void run(() => window.api.checkout(stripRemote(name)), `Checked out ${stripRemote(name)}`)
    }

    function createBranch() {
        if (!newName.value.trim()) return
        void run(() => window.api.createBranch(newName.value.trim(), true), `Created branch ${newName.value}`)
        newName.value = ''
        showNew.value = false
    }

    function deleteBranch(name: string) {
        if (window.confirm(`Delete branch "${name}"?`)) void run(() => window.api.deleteBranch(name), `Deleted ${name}`)
    }
    function deleteTag(name: string) {
        if (window.confirm(`Delete tag "${name}"?`)) void run(() => window.api.deleteTag(name), `Tag ${name} deleted`)
    }
    function createTagOnHead() {
        const name = window.prompt('Tag name:')
        if (name?.trim()) void run(() => window.api.createTag(name.trim()), `Tag ${name.trim()} created`)
    }
    function openBranchContextMenu(branch: { name: string; current: boolean }, event: MouseEvent) {
        menu.value = { x: event.clientX, y: event.clientY, items: buildBranchMenu(branch) }
    }
    function handleDrop(targetBranch: string, event: DragEvent) {
        event.preventDefault()
        dropTarget.value = null
        const payload = event.dataTransfer?.getData('text/plain')
        if (!payload) return
        const [kind, value] = payload.split(':')
        if (kind === 'commit') {
            const hard = window.confirm(
                `Reset "${targetBranch}" to commit ${value.slice(0, 7)}?\n\nOK = Hard reset (discard changes)\nCancel = Soft reset (keep changes staged)`
            )
            void run(() => window.api.resetTo(value, hard ? 'hard' : 'soft'), `Reset ${targetBranch}`)
        } else if (kind === 'branch' && value !== targetBranch) {
            if (window.confirm(`Merge "${value}" into "${targetBranch}"?\n(This will checkout "${targetBranch}" first)`)) {
                void run(async () => {
                    await window.api.checkout(targetBranch)
                    await window.api.mergeBranch(value)
                }, `Merged ${value} into ${targetBranch}`)
            }
        }
    }
    function onDragOver(branchName: string, event: DragEvent) {
        if (event.dataTransfer?.types.includes('text/plain')) {
            event.preventDefault()
            dropTarget.value = branchName
        }
    }
    function stripRemote(name: string) {
        return name.replace(/^remotes\//, '')
    }
</script>

<template>
    <aside
        class="sidebar"
        :style="{ width: `${ui.sidebarWidth}px`, flexBasis: `${ui.sidebarWidth}px` }">
        <div class="sidebar-repo-card">
            <div class="sidebar-repo-icon">
                <i-lucide-folder-git2
                    width="18"
                    height="18" />
            </div>
            <div class="sidebar-repo-copy">
                <strong>{{ repo.name }}</strong>
                <span>{{ repo.branch }}</span>
            </div>
            <i-lucide-chevron-down
                width="15"
                height="15"
                class="muted-icon" />
        </div>

        <div class="sidebar-section">
            <div class="section-header">
                <button
                    class="section-toggle"
                    @click="localExpanded = !localExpanded">
                    <i-lucide-chevron-down
                        v-if="localExpanded"
                        width="13"
                        height="13" />
                    <i-lucide-chevron-right
                        v-else
                        width="13"
                        height="13" />
                    <h3>
                        LOCAL BRANCHES <span class="section-count">{{ local.length }}</span>
                    </h3>
                </button>
                <button
                    class="icon-btn accent-icon"
                    title="New branch"
                    @click="
                        () => {
                            localExpanded = true
                            showNew = !showNew
                        }
                    ">
                    <i-lucide-plus
                        width="15"
                        height="15" />
                </button>
            </div>

            <template v-if="localExpanded">
            <form
                v-if="showNew"
                class="new-branch"
                @submit.prevent="createBranch">
                <input
                    v-model="newName"
                    autofocus
                    placeholder="New branch name" />
                <button
                    type="submit"
                    class="btn primary small">
                    Create
                </button>
            </form>

            <div
                v-for="branch in local"
                :key="branch.name"
                class="branch-row"
                :class="{ current: branch.current, 'drop-target': dropTarget === branch.name }"
                draggable="true"
                @dblclick="!branch.current && checkoutBranch(branch.name)"
                :title="branch.current ? 'Current branch' : 'Double-click to checkout'"
                @contextmenu.prevent="openBranchContextMenu(branch, $event)"
                @dragstart="$event.dataTransfer?.setData('text/plain', `branch:${branch.name}`)"
                @dragover="onDragOver(branch.name, $event)"
                @dragleave="dropTarget = null"
                @drop="handleDrop(branch.name, $event)">
                <i-lucide-git-branch
                    width="14"
                    height="14" />
                <span class="branch-name">{{ branch.name }}</span>
                <span
                    v-if="branch.ahead || branch.behind"
                    class="track-badge">
                    <span
                        v-if="branch.ahead"
                        class="track-ahead">↑{{ branch.ahead }}</span>
                    <span
                        v-if="branch.behind"
                        class="track-behind">↓{{ branch.behind }}</span>
                </span>
                <span
                    v-if="!branch.current"
                    class="row-actions">
                    <button
                        class="icon-btn"
                        title="Merge into current branch"
                        @click.stop="mergeBranchIntoHead(branch.name)">
                        <i-lucide-git-merge
                            width="14"
                            height="14" />
                    </button>
                    <button
                        class="icon-btn danger"
                        title="Delete branch"
                        @click.stop="deleteBranch(branch.name)">
                        <i-lucide-trash2
                            width="14"
                            height="14" />
                    </button>
                </span>
            </div>
            </template>
        </div>

        <div class="sidebar-section remote-section">
            <div class="section-header">
                <button
                    class="section-toggle"
                    @click="remoteExpanded = !remoteExpanded">
                    <i-lucide-chevron-down
                        v-if="remoteExpanded"
                        width="13"
                        height="13" />
                    <i-lucide-chevron-right
                        v-else
                        width="13"
                        height="13" />
                    <h3>
                        REMOTE BRANCHES <span class="section-count">{{ remote.length }}</span>
                    </h3>
                </button>
                <button
                    class="icon-btn accent-icon"
                    title="Manage remotes"
                    @click="
                        () => {
                            remoteExpanded = true
                            showRemoteManager = true
                        }
                    ">
                    <i-lucide-settings2
                        width="14"
                        height="14" />
                </button>
            </div>
            <template v-if="remoteExpanded">
            <div
                v-if="remote.length === 0"
                class="sidebar-empty">
                Fetch a remote to see branches
            </div>
            <div
                v-for="branch in remote"
                :key="branch.name"
                class="branch-row remote"
                @dblclick="checkoutRemote(branch.name)"
                title="Double-click to checkout">
                <i-lucide-globe2
                    width="14"
                    height="14" />
                <span>{{ stripRemote(branch.name) }}</span>
            </div>
            </template>
        </div>

        <div class="sidebar-section remote-section">
            <div class="section-header">
                <button
                    class="section-toggle"
                    @click="tagsExpanded = !tagsExpanded">
                    <i-lucide-chevron-down
                        v-if="tagsExpanded"
                        width="13"
                        height="13" />
                    <i-lucide-chevron-right
                        v-else
                        width="13"
                        height="13" />
                    <h3>
                        TAGS <span class="section-count">{{ tags.length }}</span>
                    </h3>
                </button>
                <button
                    class="icon-btn accent-icon"
                    title="New tag on HEAD"
                    @click="createTagOnHead">
                    <i-lucide-plus
                        width="15"
                        height="15" />
                </button>
            </div>
            <template v-if="tagsExpanded">
            <div
                v-if="tags.length === 0"
                class="sidebar-empty">
                No tags yet
            </div>
            <div
                v-for="tag in tags"
                :key="tag.name"
                class="branch-row tag-row"
                :title="`${tag.name} (${tag.hash.slice(0, 7)})`">
                <i-lucide-tag
                    width="13"
                    height="13" />
                <span class="branch-name">{{ tag.name }}</span>
                <span class="row-actions">
                    <button
                        class="icon-btn danger"
                        :title="`Delete tag ${tag.name}`"
                        @click="deleteTag(tag.name)">
                        <i-lucide-trash2
                            width="13"
                            height="13" />
                    </button>
                </span>
            </div>
            </template>
        </div>

        <StashPanel
            :repo-path="repo.path"
            :refresh="props.refresh" />

        <div class="sidebar-bottom">
            <div class="sidebar-bottom-actions">
                <button
                    class="toolbar-action action-stash"
                    title="Stash changes"
                    @click="actStash()">
                    <i-lucide-archive
                        width="15"
                        height="15" />
                    <span>Stash</span>
                </button>
                <button
                    class="toolbar-icon-button"
                    :title="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
                    @click="ui.toggleTheme()">
                    <i-lucide-sun
                        v-if="ui.theme === 'dark'"
                        width="16"
                        height="16" />
                    <i-lucide-moon
                        v-else
                        width="16"
                        height="16" />
                </button>
                <button
                    class="toolbar-icon-button"
                    :class="{ 'bisect-active': repoStore.repoState.bisectActive }"
                    title="Settings"
                    @click="repoStore.toolsOpen = true">
                    <i-lucide-settings
                        width="17"
                        height="17" />
                </button>
            </div>
        </div>

        <ContextMenuVue
            :menu="menu"
            @close="menu = null" />
        <RemoteManager
            v-if="showRemoteManager"
            :refresh="props.refresh"
            @close="showRemoteManager = false" />
    </aside>
</template>
