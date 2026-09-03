<script setup lang="ts">
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { resolveCheckoutMode } from '../utils/checkout'
    import { confirmDialog } from '../utils/confirm'
    import { promptDialog } from '../utils/prompt'
    import CollapseAllButton from './CollapseAllButton.vue'
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'
    import LocalBranchContextMenu, { type LocalBranchMenuState } from './LocalBranchContextMenu.vue'
    import StashPanel from './StashPanel.vue'
    import TagContextMenu, { type TagMenuState } from './TagContextMenu.vue'

    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import type { MenuItem, RepoStatus } from '@shared/types'

    const props = defineProps<{ repo: RepoStatus; refresh: () => Promise<unknown> }>()
    const emit = defineEmits<{ (e: 'interactive-rebase', baseRef: string): void }>()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})
    const uiTransient = useUiTransientStore()

    const ui = useUiStore()

    const ZOOM_CHOICES = [70, 80, 90, 100, 110, 125, 140, 150]
    const appVersion = ref('')
    const zoomMenuOpen = ref(false)
    const zoomMenuRoot = ref<HTMLElement | null>(null)
    function selectZoom(value: number) {
        ui.zoom = value
        zoomMenuOpen.value = false
    }
    function onZoomMenuMouseDown(event: MouseEvent) {
        if (zoomMenuOpen.value && zoomMenuRoot.value && !zoomMenuRoot.value.contains(event.target as Node)) zoomMenuOpen.value = false
    }
    function onZoomMenuKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') zoomMenuOpen.value = false
    }
    onMounted(() => {
        void window.api
            .getVersion()
            .then(version => {
                appVersion.value = version
            })
            .catch(() => {})
        document.addEventListener('mousedown', onZoomMenuMouseDown)
        document.addEventListener('keydown', onZoomMenuKeyDown)
    })
    onBeforeUnmount(() => {
        document.removeEventListener('mousedown', onZoomMenuMouseDown)
        document.removeEventListener('keydown', onZoomMenuKeyDown)
    })
    const repoStore = useRepoStore()
    const activeDotColor = computed(() => {
        const tab = repoStore.tabs[repoStore.activeTab]
        return tab ? (ui.repoTabColors[tab.path] ?? null) : null
    })
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
    const allSectionsCollapsed = computed(
        () => !ui.sidebarSections.local && !ui.sidebarSections.remote && !ui.sidebarSections.tags && !ui.sidebarSections.stashes
    )
    function toggleAllSections() {
        const target = allSectionsCollapsed.value
        ui.sidebarSections.local = target
        ui.sidebarSections.remote = target
        ui.sidebarSections.tags = target
        ui.sidebarSections.stashes = target
    }

    const search = ref('')
    const searching = computed(() => search.value.trim().length > 0)
    const matchText = (text: string) => text.toLowerCase().includes(search.value.trim().toLowerCase())
    const localFiltered = computed(() => local.value.filter(b => matchText(b.name)))
    const remoteFiltered = computed(() => remote.value.filter(b => matchText(b.name)))
    const tagsFiltered = computed(() => tags.value.filter(t => matchText(t.name)))
    const remoteExpanded = computed({
        get: () => ui.sidebarSections.remote,
        set: value => {
            ui.sidebarSections.remote = value
        },
    })
    const menu = ref<MenuState | null>(null)
    const localBranchMenu = ref<LocalBranchMenuState | null>(null)
    const dropTarget = ref<string | null>(null)
    const activeTag = ref<string | null>(null)
    const tagMenu = ref<TagMenuState | null>(null)
    const remoteTagNames = ref<string[]>([])
    const hasRemote = ref(false)
    const pendingRemoteTag = ref<string | null>(null)

    function focusBranch(branch: { name: string; commitHash?: string }) {
        const hash =
            branch.commitHash ??
            repoStore.commits.find(commit => commit.refs.some(ref => ref === branch.name || ref === `HEAD -> ${branch.name}`))?.hash
        if (hash) repoStore.pendingFocusHash = hash
    }

    async function loadAll() {
        // Branches come from the repo store — refresh() already fetched them, so don't spawn a
        // second branch:list per refresh (spawn cost dominates on Windows). Fall back to a
        // direct fetch only when the store hasn't loaded any yet.
        if (repoStore.branchList) {
            local.value = repoStore.branchList.local
            remote.value = repoStore.branchList.remote
        } else {
            try {
                const branches = await window.api.branches()
                local.value = branches.local
                remote.value = branches.remote
            } catch {}
        }
        try {
            tags.value = await window.api.tags()
        } catch {}
        try {
            const [names, has] = await Promise.all([window.api.remoteTags(), window.api.hasRemote()])
            remoteTagNames.value = names
            hasRemote.value = has
        } catch {}
    }

    watch(() => props.repo, loadAll, { immediate: true })

    async function run(fn: () => Promise<unknown>, ok: string, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(async () => {
                await fn()
                await props.refresh()
                await loadAll()
            }, busyLabel)
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

    async function checkoutBranch(name: string) {
        const mode = await resolveCheckoutMode(name)
        if (!mode) return
        void run(() => window.api.checkout(name, mode), `Checked out ${name}`)
    }
    function localNameForRemote(name: string) {
        return name.replace(/^remotes\/[^/]+\//, '')
    }
    function isRemoteCurrent(name: string) {
        const target = localNameForRemote(name)
        return local.value.some(b => b.name === target && b.current)
    }
    async function checkoutRemote(name: string) {
        if (isRemoteCurrent(name)) {
            notify(`Already on ${localNameForRemote(name)}`, 'error', { asToast: true })
            return
        }
        const target = localNameForRemote(name)
        const mode = await resolveCheckoutMode(target)
        if (!mode) return
        void run(() => window.api.checkout(target, mode), `Checked out ${target}`)
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
    function pullRebaseCurrentBranch(branch: LocalBranchMenuState['branch']) {
        void run(() => window.api.pull(true), `Pulled ${branch.name} (rebase)`)
    }
    function rebaseOntoBranch(branch: LocalBranchMenuState['branch']) {
        emit('interactive-rebase', branch.name)
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
        const result = await promptDialog({
            title: 'Create branch here…',
            message: `New branch at "${branch.name}"`,
            placeholder: 'branch name',
            confirmLabel: 'Create',
            existing: local.value.map(b => b.name),
            branchOptions: { checkout: true, localChanges: 'stash' },
        })
        if (!result?.name) return
        void run(
            () => window.api.createBranch(result.name, result.checkout, branch.commitHash ?? undefined, result.localChanges),
            `Created branch ${result.name}`,
            `Creating branch ${result.name}…`
        )
    }
    async function createTagHere(branch: LocalBranchMenuState['branch']) {
        const result = await promptDialog({
            title: 'Create tag here…',
            message: `New tag at "${branch.name}"`,
            placeholder: 'tag name',
            confirmLabel: 'Create',
            existing: tags.value.map(t => t.name),
        })
        if (!result?.name) return
        void run(
            () => window.api.createTag(result.name, branch.commitHash ?? null),
            `Tag ${result.name} created`,
            `Creating tag ${result.name}…`
        )
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
        activeTag.value = tag.name
        if (!tag.hash) return
        repoStore.pendingFocusHash = tag.hash
    }
    function openLocalBranchContextMenu(branch: { name: string; current: boolean; commitHash?: string }, event: MouseEvent) {
        localBranchMenu.value = { x: event.clientX, y: event.clientY, branch, hasRemote: hasRemote.value, currentBranch: props.repo.branch }
    }
    function openRemoteBranchContextMenu(branch: { name: string; current: boolean }, event: MouseEvent) {
        menu.value = { x: event.clientX, y: event.clientY, items: buildRemoteBranchMenu(branch) }
    }
    async function handleDrop(targetBranch: string, event: DragEvent) {
        event.preventDefault()
        dropTarget.value = null
        const payload = event.dataTransfer?.getData('text/plain')
        if (!payload) return
        const [kind, value] = payload.split(':')
        if (kind === 'commit') {
            const ok = await confirmDialog({
                title: 'Reset branch',
                message: 'All uncommitted changes will be lost.\n(Use the commit context menu for a soft reset.)',
                flow: { from: value.slice(0, 7), to: targetBranch, label: 'reset to' },
                confirmLabel: 'Hard reset',
                danger: true,
                confirmIcon: 'reset',
            })
            if (!ok) return
            void run(() => window.api.resetTo(value, 'hard'), `Reset ${targetBranch}`)
        } else if (kind === 'branch' && value !== targetBranch) {
            let status: { kind: 'ok' | 'warn' | 'unknown'; text: string }
            let willConflict = false
            try {
                const check = await uiTransient.withBusy(
                    () => window.api.mergeCheckConflicts(value, targetBranch),
                    `Checking merge of ${value} into ${targetBranch}…`
                )
                willConflict = check.conflicts.length > 0
                status = !check.supported
                    ? { kind: 'unknown', text: 'Conflict check unavailable (git too old)' }
                    : willConflict
                      ? { kind: 'warn', text: `Merge will cause conflicts — ${check.conflicts.length} file(s)` }
                      : check.fastForward
                        ? { kind: 'ok', text: 'Fast-forward — no conflicts possible' }
                        : { kind: 'ok', text: 'Merge can be done without conflicts' }
            } catch {
                status = { kind: 'unknown', text: 'Conflict check unavailable' }
            }
            const ok = await confirmDialog({
                title: 'Merge branch',
                message: willConflict
                    ? `Will checkout "${targetBranch}" to resolve conflicts.`
                    : 'Merges without switching your current branch.',
                flow: { from: value, to: targetBranch },
                status,
                confirmLabel: 'Merge',
            })
            if (!ok) return
            void run(
                () => window.api.mergeInto(value, targetBranch),
                `Merged ${value} into ${targetBranch}`,
                `Merging ${value} into ${targetBranch}…`
            )
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
        <div class="sidebar-toolbar">
            <div class="section-search">
                <i-lucide-search
                    width="12"
                    height="12" />
                <input
                    v-model="search"
                    class="section-search-input"
                    type="text"
                    placeholder="Search…"
                    aria-label="Search sidebar" />
                <button
                    v-if="search"
                    type="button"
                    class="search-clear"
                    aria-label="Clear search"
                    @click="search = ''">
                    ×
                </button>
            </div>
            <CollapseAllButton
                :all-collapsed="allSectionsCollapsed"
                @toggle="toggleAllSections()" />
        </div>

        <div
            class="sidebar-section"
            :class="{ grow: localExpanded, collapsed: !localExpanded }">
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

            <div class="section-body">
                <template v-if="localExpanded || searching">
                    <div
                        v-for="branch in localFiltered"
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
                        <span
                            v-if="branch.current"
                            class="branch-active-dot"
                            :style="activeDotColor ? { '--dot-color': activeDotColor } : undefined"
                            aria-hidden="true" />
                        <i-lucide-git-branch
                            v-else
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
                                class="track-ahead"
                                >↑{{ branch.ahead }}</span
                            >
                            <span
                                v-if="branch.behind"
                                class="track-behind"
                                >↓{{ branch.behind }}</span
                            >
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
        </div>

        <div
            class="sidebar-section remote-section"
            :class="{ grow: remoteExpanded, collapsed: !remoteExpanded }">
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
            </div>
            <div class="section-body">
                <template v-if="remoteExpanded || searching">
                    <div
                        v-if="remote.length === 0"
                        class="sidebar-empty">
                        Fetch a remote to see branches
                    </div>
                    <div
                        v-for="branch in remoteFiltered"
                        :key="branch.name"
                        class="branch-row remote"
                        :class="{ current: isRemoteCurrent(branch.name) }"
                        @click="focusBranch(branch)"
                        @dblclick="checkoutRemote(branch.name)"
                        @contextmenu.prevent="openRemoteBranchContextMenu(branch, $event)"
                        :title="
                            isRemoteCurrent(branch.name)
                                ? 'Already checked out locally'
                                : 'Click to locate · Double-click to checkout · Right-click for options'
                        ">
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
        </div>

        <div
            class="sidebar-section remote-section"
            :class="{ grow: tagsExpanded, collapsed: !tagsExpanded }">
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
            <div class="section-body">
                <template v-if="tagsExpanded || searching">
                    <div
                        v-if="tags.length === 0"
                        class="sidebar-empty">
                        No tags yet
                    </div>
                    <div
                        v-for="tag in tagsFiltered"
                        :key="tag.name"
                        class="branch-row tag-row"
                        :class="{ active: activeTag === tag.name }"
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
        </div>

        <StashPanel
            :repo-path="repo.path"
            :filter="search"
            :refresh="props.refresh" />

        <div class="sidebar-bottom">
            <div class="sidebar-bottom-actions">
                <div
                    ref="zoomMenuRoot"
                    class="zoom-group">
                    <button
                        class="toolbar-icon-button zoom-btn"
                        title="UI zoom"
                        :aria-expanded="zoomMenuOpen"
                        @click="zoomMenuOpen = !zoomMenuOpen">
                        <i-lucide-zoom-in
                            width="15"
                            height="15" />
                        <span class="zoom-label">{{ ui.zoom }}%</span>
                        <i-lucide-chevron-up
                            width="12"
                            height="12" />
                    </button>
                    <div
                        v-if="zoomMenuOpen"
                        class="zoom-menu"
                        role="listbox"
                        aria-label="UI zoom level">
                        <button
                            v-for="value in ZOOM_CHOICES"
                            :key="value"
                            class="zoom-menu-item"
                            :class="{ active: ui.zoom === value }"
                            role="option"
                            :aria-selected="ui.zoom === value"
                            @click="selectZoom(value)">
                            <i-lucide-check
                                v-if="ui.zoom === value"
                                width="13"
                                height="13" />
                            <span
                                v-else
                                class="zoom-menu-bullet" />
                            {{ value }}%
                        </button>
                    </div>
                </div>
                <span
                    v-if="appVersion"
                    class="app-version-divider"
                    aria-hidden="true" />
                <span
                    v-if="appVersion"
                    class="app-version"
                    title="Open Git version"
                    >Version: {{ appVersion }}</span
                >
                <span
                    v-if="appVersion"
                    class="app-version-divider"
                    aria-hidden="true" />
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
        <LocalBranchContextMenu
            :menu="localBranchMenu"
            @close="localBranchMenu = null"
            @push="pushLocalBranch"
            @pull="pullLocalBranch"
            @pull-rebase="pullRebaseCurrentBranch"
            @force-push="forcePushBranch"
            @rebase-onto="rebaseOntoBranch"
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
    </aside>
</template>
