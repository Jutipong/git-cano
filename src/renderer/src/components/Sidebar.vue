<script setup lang="ts">
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { confirmDialog } from '../utils/confirm'
    import { promptDialog } from '../utils/prompt'
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'
    import LocalBranchContextMenu, { type LocalBranchMenuState } from './LocalBranchContextMenu.vue'
    import RemoteManager from './RemoteManager.vue'
    import StashPanel from './StashPanel.vue'
    import TagContextMenu, { type TagMenuState } from './TagContextMenu.vue'
    import ThemePicker from './ThemePicker.vue'

    import type { MenuItem, RepoStatus } from '@shared/types'
    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'

    const props = defineProps<{ repo: RepoStatus; refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})
    const uiTransient = useUiTransientStore()

    const ui = useUiStore()
    const repoStore = useRepoStore()
    const local = ref<{ name: string; current: boolean; detached?: boolean; ahead?: number; behind?: number; commitHash?: string }[]>([])
    const remote = ref<{ name: string; current: boolean; commitHash?: string }[]>([])
    const tags = ref<{ name: string; hash: string }[]>([])
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
    const menu = ref<MenuState | null>(null)
    const localBranchMenu = ref<LocalBranchMenuState | null>(null)
    const dropTarget = ref<string | null>(null)
    const showRemoteManager = ref(false)
    const tagMenu = ref<TagMenuState | null>(null)
    const remoteTagNames = ref<string[]>([])
    const hasRemote = ref(false)
    const pendingRemoteTag = ref<string | null>(null)

    const syncBusy = ref<string | null>(null)

    function actFetch() {
        void sync('Fetch', () => window.api.fetch(), 'Fetch completed')
    }

    function focusBranch(branch: { name: string; commitHash?: string }) {
        const hash =
            branch.commitHash ??
            repoStore.commits.find(commit =>
                commit.refs.some(ref => ref === branch.name || ref === `HEAD -> ${branch.name}`)
            )?.hash
        if (hash) repoStore.pendingFocusHash = hash
    }
    function actPull() {
        void sync('Pull', () => window.api.pull(), 'Pull completed')
    }
    function actPush() {
        void sync('Push', () => window.api.push(), 'Push completed')
    }

    async function sync(label: string, fn: () => Promise<unknown>, ok: string) {
        if (syncBusy.value) return
        syncBusy.value = label
        await run(fn, ok, `${label}ing…`)
        syncBusy.value = null
    }

    async function loadAll() {
        try {
            const branches = await window.api.branches()
            local.value = branches.local
            remote.value = branches.remote
        } catch {
        }
        try {
            tags.value = await window.api.tags()
        } catch {
        }
        try {
            const [names, has] = await Promise.all([window.api.remoteTags(), window.api.hasRemote()])
            remoteTagNames.value = names
            hasRemote.value = has
        } catch {
        }
    }

    watch(() => props.repo, loadAll, { immediate: true })

    async function run(fn: () => Promise<unknown>, ok: string, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(fn, busyLabel)
            await props.refresh()
            await loadAll()
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function buildRemoteBranchMenu(branch: { name: string; current: boolean }): MenuItem[] {
        return [
            {
                label: `Checkout ${localNameForRemote(branch.name)}`,
                icon: 'git-branch',
                action: () => void checkoutRemote(branch.name),
            },
            {
                label: `Delete ${stripRemote(branch.name)}`,
                icon: 'trash',
                danger: true,
                separatorBefore: true,
                action: () => void deleteRemoteBranch(branch.name),
            },
        ]
    }

    function checkoutBranch(name: string) {
        void run(() => window.api.checkout(name), `Checked out ${name}`)
    }
    function localNameForRemote(name: string) {
        return name.replace(/^remotes\/[^/]+\//, '')
    }
    function isRemoteCurrent(name: string) {
        const target = localNameForRemote(name)
        return local.value.some(b => b.name === target && b.current)
    }
    function checkoutRemote(name: string) {
        if (isRemoteCurrent(name)) {
            notify(`Already on ${localNameForRemote(name)}`, 'error', { asToast: true })
            return
        }
        const target = localNameForRemote(name)
        void run(() => window.api.checkout(target), `Checked out ${target}`)
    }

    async function deleteBranch(name: string) {
        const ok = await confirmDialog({
            message: `Delete branch: ${name}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.deleteBranch(name), `Deleted ${name}`)
    }
    async function deleteRemoteBranch(ref: string) {
        const label = stripRemote(ref)
        const ok = await confirmDialog({
            message: `Delete remote branch: ${label}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.deleteRemoteBranch(ref), `Remote branch ${label} deleted`)
    }
    async function deleteTag(tag: { name: string; hash: string }) {
        const ok = await confirmDialog({
            message: `Delete tag: ${tag.name}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.deleteTag(tag.name), `Tag ${tag.name} deleted`)
    }
    function copyTagName(tag: { name: string }) {
        void navigator.clipboard
            .writeText(tag.name)
            .then(() => notify('Tag name copied', 'success'))
            .catch(() => notify('Copy failed', 'error'))
    }
    function pushLocalBranch(branch: LocalBranchMenuState['branch']) {
        void run(() => window.api.pushBranch(branch.name), `Pushed ${branch.name}`)
    }
    function pullLocalBranch(branch: LocalBranchMenuState['branch']) {
        void run(() => window.api.pullBranch(branch.name), `Pulled ${branch.name}`)
    }
    function forcePushBranch(branch: LocalBranchMenuState['branch']) {
        void (async () => {
            const ok = await confirmDialog({
                message: `Force push ${branch.name}?\nThis will overwrite remote history.`,
                confirmLabel: 'Force push',
                danger: true,
            })
            if (!ok) return
            void run(() => window.api.pushBranch(branch.name, true), `Force-pushed ${branch.name}`)
        })()
    }
    async function createBranchHere(branch: LocalBranchMenuState['branch']) {
        const name = await promptDialog({
            title: 'Create branch here…',
            message: `New branch at "${branch.name}"`,
            placeholder: 'branch name',
            confirmLabel: 'Create',
            existing: local.value.map(b => b.name),
        })
        if (!name?.trim()) return
        void run(() => window.api.createBranch(name.trim(), false, branch.commitHash ?? undefined), `Created branch ${name.trim()}`, `Creating branch ${name.trim()}…`)
    }
    async function createTagHere(branch: LocalBranchMenuState['branch']) {
        const name = await promptDialog({
            title: 'Create tag here…',
            message: `New tag at "${branch.name}"`,
            placeholder: 'tag name',
            confirmLabel: 'Create',
            existing: tags.value.map(t => t.name),
        })
        if (!name?.trim()) return
        void run(() => window.api.createTag(name.trim(), branch.commitHash ?? null), `Tag ${name.trim()} created`, `Creating tag ${name.trim()}…`)
    }
    function copyBranchName(branch: LocalBranchMenuState['branch']) {
        void navigator.clipboard
            .writeText(branch.name)
            .then(() => notify('Branch name copied', 'success'))
            .catch(() => notify('Copy failed', 'error'))
    }
    function deleteLocalBranch(branch: LocalBranchMenuState['branch']) {
        void deleteBranch(branch.name)
    }
    function pushTagToRemote(tag: { name: string }) {
        void (async () => {
            const ok = await confirmDialog({
                message: `Push tag: ${tag.name}`,
                confirmLabel: 'Push',
            })
            if (!ok) return
            pendingRemoteTag.value = tag.name
            void run(() => window.api.pushTag(tag.name), `Tag ${tag.name} pushed`).finally(() => {
                if (pendingRemoteTag.value === tag.name) pendingRemoteTag.value = null
            })
        })()
    }
    function deleteRemoteTag(tag: { name: string }) {
        void (async () => {
            const ok = await confirmDialog({
                message: `Delete remote tag: ${tag.name}`,
                confirmLabel: 'Delete',
                danger: true,
            })
            if (!ok) return
            pendingRemoteTag.value = tag.name
            void run(() => window.api.deleteRemoteTag(tag.name), `Remote tag ${tag.name} deleted`).finally(() => {
                if (pendingRemoteTag.value === tag.name) pendingRemoteTag.value = null
            })
        })()
    }
    function openTagMenu(tag: { name: string; hash: string }, event: MouseEvent) {
        tagMenu.value = {
            x: event.clientX,
            y: event.clientY,
            tag,
            onRemote: remoteTagNames.value.includes(tag.name),
            canPush: hasRemote.value,
        }
    }
    function focusTag(tag: { name: string; hash: string }) {
        if (!tag.hash) return
        repoStore.pendingFocusHash = tag.hash
    }
    function openLocalBranchContextMenu(branch: { name: string; current: boolean; commitHash?: string }, event: MouseEvent) {
        localBranchMenu.value = { x: event.clientX, y: event.clientY, branch, hasRemote: hasRemote.value }
    }
    function openRemoteBranchContextMenu(branch: { name: string; current: boolean }, event: MouseEvent) {
        menu.value = { x: event.clientX, y: event.clientY, items: buildRemoteBranchMenu(branch) }
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
        <div class="sidebar-repo-card repo-sync-card">
            <div class="repo-sync-actions">
                <button
                    class="toolbar-action action-fetch"
                    :disabled="!!syncBusy"
                    title="Fetch"
                    @click="actFetch()">
                    <i-lucide-arrow-down-to-line
                        :class="{ 'bouncing-down': syncBusy === 'Fetch' }"
                        width="15"
                        height="15" />
                    <span>Fetch</span>
                </button>
                <button
                    class="toolbar-action action-pull"
                    :disabled="!!syncBusy"
                    title="Pull"
                    @click="actPull()">
                    <i-lucide-arrow-down
                        :class="{ 'bouncing-down': syncBusy === 'Pull' }"
                        width="15"
                        height="15" />
                    <span>Pull</span>
                    <span
                        v-if="repo.behind"
                        class="sync-count">{{ repo.behind }}</span>
                </button>
                <button
                    class="toolbar-action primary-action"
                    :disabled="!!syncBusy"
                    title="Push"
                    @click="actPush()">
                    <i-lucide-arrow-up
                        :class="{ 'bouncing-up': syncBusy === 'Push' }"
                        width="15"
                        height="15" />
                    <span>Push</span>
                    <span
                        v-if="repo.ahead"
                        class="sync-count">{{ repo.ahead }}</span>
                </button>
            </div>
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
            </div>

            <template v-if="localExpanded">
            <div
                v-for="branch in local"
                :key="branch.name"
                class="branch-row"
                :class="{ current: branch.current, 'drop-target': dropTarget === branch.name }"
                draggable="true"
                @click="focusBranch(branch)"
                @dblclick="!branch.current && checkoutBranch(branch.name)"
                :title="
                    branch.detached
                        ? 'Detached HEAD — click to locate this commit'
                        : branch.current
                          ? 'Current branch'
                          : 'Click to locate · Double-click to checkout'
                "
                @contextmenu.prevent="openLocalBranchContextMenu(branch, $event)"
                @dragstart="$event.dataTransfer?.setData('text/plain', `branch:${branch.name}`)"
                @dragover="onDragOver(branch.name, $event)"
                @dragleave="dropTarget = null"
                @drop="handleDrop(branch.name, $event)">
                <i-lucide-git-branch
                    width="14"
                    height="14" />
                <span class="branch-name">
                    <template v-if="branch.detached">
                        <span class="branch-detached">HEAD</span>
                        <span class="branch-detached-hash">{{ branch.name }}</span>
                    </template>
                    <template v-else>{{ branch.name }}</template>
                </span>
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
                    class="icon-btn remote-settings-btn"
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
                :class="{ current: isRemoteCurrent(branch.name) }"
                @click="focusBranch(branch)"
                @dblclick="checkoutRemote(branch.name)"
                @contextmenu.prevent="openRemoteBranchContextMenu(branch, $event)"
                :title="isRemoteCurrent(branch.name) ? 'Already checked out locally' : 'Click to locate · Double-click to checkout · Right-click for options'">
                <i-lucide-globe2
                    width="14"
                    height="14" />
                <span class="branch-name">{{ stripRemote(branch.name) }}</span>
                <span class="row-actions">
                    <button
                        class="icon-btn danger"
                        title="Delete remote branch"
                        @click.stop="deleteRemoteBranch(branch.name)">
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
                :title="`${tag.name} (${tag.hash ? tag.hash.slice(0, 7) : '?'}) · Click to locate`"
                @click="focusTag(tag)"
                @contextmenu.prevent="openTagMenu(tag, $event)">
                <i-lucide-tag
                    width="13"
                    height="13" />
                <i-lucide-loader-2
                    v-if="pendingRemoteTag === tag.name"
                    class="tag-remote-ic spinning"
                    title="Working…"
                    width="14"
                    height="14" />
                <i-lucide-cloud
                    v-else-if="remoteTagNames.includes(tag.name)"
                    class="tag-remote-ic"
                    title="On remote"
                    width="14"
                    height="14" />
                <i-lucide-cloud-off
                    v-else-if="hasRemote"
                    class="tag-remote-ic off"
                    title="Not pushed to remote"
                    width="14"
                    height="14" />
                <span class="branch-name">{{ tag.name }}</span>
            </div>
            </template>
        </div>

        <StashPanel
            :repo-path="repo.path"
            :refresh="props.refresh" />

        <div class="sidebar-bottom">
            <div class="sidebar-bottom-actions">
                <button
                    class="toolbar-icon-button"
                    :class="{ 'bisect-active': repoStore.repoState.bisectActive }"
                    title="Settings"
                    @click="repoStore.toolsOpen = true">
                    <i-lucide-settings
                        width="17"
                        height="17" />
                </button>
                <ThemePicker />
            </div>
        </div>

        <ContextMenuVue
            :menu="menu"
            @close="menu = null" />
        <LocalBranchContextMenu
            :menu="localBranchMenu"
            @close="localBranchMenu = null"
            @push="pushLocalBranch"
            @pull="pullLocalBranch"
            @force-push="forcePushBranch"
            @delete="deleteLocalBranch"
            @create-branch-here="createBranchHere"
            @create-tag-here="createTagHere"
            @copy-name="copyBranchName" />
        <TagContextMenu
            :menu="tagMenu"
            @close="tagMenu = null"
            @copy-name="copyTagName"
            @delete="deleteTag"
            @push="pushTagToRemote"
            @delete-remote="deleteRemoteTag" />
        <RemoteManager
            v-if="showRemoteManager"
            :refresh="props.refresh"
            @close="showRemoteManager = false" />
    </aside>
</template>
