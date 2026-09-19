<script setup lang="ts">
    import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
    import ICodiconDesktopDownload from '~icons/codicon/desktop-download'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideChevronRight from '~icons/lucide/chevron-right'
    import ILucideChevronUp from '~icons/lucide/chevron-up'
    import ILucideCloud from '~icons/lucide/cloud'
    import ILucideCloudOff from '~icons/lucide/cloud-off'
    import ILucideCrosshair from '~icons/lucide/crosshair'
    import ILucideGitBranch from '~icons/lucide/git-branch'
    import ILucideGlobe2 from '~icons/lucide/globe2'
    import ILucideSearch from '~icons/lucide/search'
    import ILucideSettings from '~icons/lucide/settings'
    import ILucideTag from '~icons/lucide/tag'
    import ILucideTrash2 from '~icons/lucide/trash2'
    import ILucideZoomIn from '~icons/lucide/zoom-in'

    import canoIcon from '../assets/cano.svg'
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUpdaterStore } from '../stores/updater'
    import { useUiTransientStore, type NotifyOptions, type ToastKind } from '../stores/uiTransient'
    import { resolveCheckoutMode } from '../utils/checkout'
    import { confirmDialog, confirmDialogWithOption } from '../utils/confirm'
    import { promptDialog } from '../utils/prompt'
    import { notifyUndoable } from '../utils/undo'
    import CollapseAllButton from './CollapseAllButton.vue'
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'
    import LocalBranchContextMenu, { type LocalBranchMenuState } from './LocalBranchContextMenu.vue'
    import StashPanel from './StashPanel.vue'
    import TagContextMenu, { type TagMenuState } from './TagContextMenu.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { LocalChangesMode, MenuItem, RepoStatus } from '@shared/types'

    const props = defineProps<{ repo: RepoStatus; refresh: () => Promise<unknown> }>()
    const emit = defineEmits<{
        (e: 'interactive-rebase', baseRef: string): void
        (
            e: 'create-tag',
            target: { hash: string | null; subject?: string | null; shortHash?: string | null; branchName?: string | null }
        ): void
    }>()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})
    const uiTransient = useUiTransientStore()

    const ui = useUiStore()

    const ZOOM_CHOICES = [70, 80, 90, 100, 110, 125, 140, 150]
    const appVersion = ref('')
    const updater = useUpdaterStore()
    const showUpdateButton = computed(() => updater.status === 'available' || updater.status === 'downloading' || updater.status === 'downloaded')
    const updateButtonTitle = computed(() => {
        if (updater.status === 'downloaded') return `Restart to install ${updater.downloadedVersion || updater.latestVersion}`
        if (updater.canAuto === false) return `Update available: ${updater.latestVersion} — open Settings`
        return `Download update ${updater.latestVersion}`
    })
    function handleUpdateVersionClick() {
        repoStore.toolsTab = 'general'
        repoStore.toolsOpen = true
    }
    async function handleUpdateButtonClick() {
        if (updater.status === 'downloaded') {
            void updater.installUpdate(notify)
            return
        }
        if (updater.status !== 'available') return
        const auto = await updater.ensureAutoSupport()
        if (auto) void updater.downloadUpdate(notify)
        else handleUpdateVersionClick()
    }
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
        void updater.ensureAutoSupport().catch(() => {})
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
    // Branch/tag data comes from the repo store — refresh() fetches local data alongside the log,
    // while remote tag state is refreshed in the background.
    const local = computed(() => repoStore.branchList?.local ?? [])
    const remote = computed(() => repoStore.branchList?.remote ?? [])
    const tags = computed(() => repoStore.tagList)
    const loadingTags = computed(() => repoStore.loadingTags)
    const loadingRemoteTags = computed(() => repoStore.loadingRemoteTags)
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
    const remoteTagNames = computed(() => repoStore.remoteTagNames)
    const hasRemote = computed(() => repoStore.hasRemote)
    const pendingRemoteTag = ref<string | null>(null)

    function focusBranch(branch: { name: string; commitHash?: string }) {
        // While soloing, selection is locked to the soloed branch — silently ignore other rows.
        if (repoStore.soloBranch && repoStore.soloBranch !== branch.name) return
        const hash =
            branch.commitHash ??
            repoStore.commits.find(commit => commit.refs.some(ref => ref === branch.name || ref === `HEAD -> ${branch.name}` || ref === `remote:${branch.name}`))?.hash
        if (hash) repoStore.pendingFocusHash = hash
    }

    function toggleSolo(name: string) {
        void repoStore.setSolo(repoStore.soloBranch === name ? null : name)
    }

    async function run(fn: () => Promise<unknown>, ok: string, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(async () => {
                await fn()
                await props.refresh()
            }, busyLabel)
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function runUndoable(fn: () => Promise<unknown>, ok: string, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(async () => {
                await fn()
                await props.refresh()
            }, busyLabel)
            await notifyUndoable(props.repo.path, ok)
        } catch (error) {
            await props.refresh().catch(() => {})
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function buildRemoteBranchMenu(branch: { name: string; current: boolean }): MenuItem[] {
        const soloed = repoStore.soloBranch === branch.name
        const items: MenuItem[] = [
            {
                label: soloed ? 'Unsolo' : 'Solo',
                accent: true,
                action: () => toggleSolo(branch.name),
            },
            {
                label: `Checkout ${localNameForRemote(branch.name)}`,
                icon: 'git-branch',
                separatorBefore: true,
                action: () => void checkoutRemote(branch.name),
            },
        ]
        // MenuItem has no disabled state — omit delete while soloing (deleteRemoteBranch guards it too)
        if (!repoStore.soloBranch) {
            items.push({
                label: `Delete ${stripRemote(branch.name)}`,
                icon: 'trash',
                danger: true,
                separatorBefore: true,
                action: () => void deleteRemoteBranch(branch.name),
            })
        }
        return items
    }

    async function checkoutBranch(name: string) {
        if (repoStore.soloBranch && repoStore.soloBranch !== name) return
        const mode = await resolveCheckoutMode(name)
        if (!mode) return
        void run(() => window.api.checkout(name, mode), `Checked out ${name}`)
    }
    function localNameForRemote(name: string) {
        return name.replace(/^(?:remotes\/)?[^/]+\//, '')
    }
    function isRemoteCurrent(name: string) {
        const target = localNameForRemote(name)
        return local.value.some(b => b.name === target && b.current)
    }
    async function checkoutRemote(name: string) {
        if (repoStore.soloBranch && repoStore.soloBranch !== name) return
        if (isRemoteCurrent(name)) {
            notify(`Already on ${localNameForRemote(name)}`, 'error', { asToast: true })
            return
        }
        const target = localNameForRemote(name)
        const mode = await resolveCheckoutMode(target)
        if (!mode) return
        void run(() => window.api.checkoutRemote(name, mode), `Checked out ${target}`)
    }

    async function deleteBranch(name: string) {
        if (repoStore.soloBranch) {
            notify('Unsolo before deleting branches', 'error', { asToast: true })
            return
        }
        const ok = await confirmDialog({
            message: `Delete branch: ${name}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.deleteBranch(name), `Deleted ${name}`)
    }
    async function deleteRemoteBranch(ref: string) {
        if (repoStore.soloBranch) {
            notify('Unsolo before deleting branches', 'error', { asToast: true })
            return
        }
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
        if (!remoteTagNames.value.includes(tag.name)) {
            const ok = await confirmDialog({
                message: `Delete tag: ${tag.name}`,
                confirmLabel: 'Delete',
                danger: true,
            })
            if (!ok) return
            void run(() => window.api.deleteTag(tag.name), `Tag ${tag.name} deleted`)
            return
        }
        const result = await confirmDialogWithOption({
            message: `Delete tag: ${tag.name}`,
            confirmLabel: 'Delete',
            danger: true,
            checkOption: { label: 'Also delete on origin', defaultChecked: false },
        })
        if (!result.ok) return
        if (result.checked) pendingRemoteTag.value = tag.name
        let remoteError: string | null = null
        try {
            await uiTransient.withBusy(async () => {
                await window.api.deleteTag(tag.name)
                if (result.checked) {
                    try {
                        await window.api.deleteRemoteTag(tag.name)
                    } catch (error) {
                        remoteError = String(error).replace(/^Error:\s*/, '')
                    }
                }
                await props.refresh()
            })
            if (remoteError) notify(`Tag ${tag.name} deleted locally, but remote delete failed: ${remoteError}`, 'error')
            else notify(result.checked ? `Tag ${tag.name} deleted locally and on origin` : `Tag ${tag.name} deleted`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            if (pendingRemoteTag.value === tag.name) pendingRemoteTag.value = null
        }
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
                confirmIcon: 'force-push',
                danger: true,
            })
            if (!ok) return
            void run(() => window.api.pushBranch(branch.name, true), `Force-pushed ${branch.name}`)
        })()
    }
    async function createBranchHere(branch: LocalBranchMenuState['branch']) {
        const result = await promptDialog({
            title: 'Create branch',
            chip: branch.name,
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
    function createTagHere(branch: LocalBranchMenuState['branch']) {
        const commit = branch.commitHash
            ? (repoStore.commits.find(c => c.hash === branch.commitHash) ?? null)
            : (repoStore.commits.find(c => c.refs.some(ref => ref === branch.name || ref === `HEAD -> ${branch.name}` || ref === `remote:${branch.name}`)) ?? null)
        const hash = commit?.hash ?? branch.commitHash ?? null
        if (!hash) {
            notify('Cannot locate commit for this branch', 'error')
            return
        }
        emit('create-tag', {
            hash,
            subject: commit?.subject ?? null,
            shortHash: commit?.shortHash ?? hash.slice(0, 7),
            branchName: branch.name,
        })
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
        localBranchMenu.value = {
            x: event.clientX,
            y: event.clientY,
            branch,
            hasRemote: hasRemote.value,
            currentBranch: props.repo.branch,
            soloed: repoStore.soloBranch === branch.name,
            soloActive: !!repoStore.soloBranch,
        }
    }
    function openRemoteBranchContextMenu(branch: { name: string; current: boolean }, event: MouseEvent) {
        menu.value = { x: event.clientX, y: event.clientY, items: buildRemoteBranchMenu(branch) }
    }
    /** Split a drag payload (`kind:value`) on the first colon — branch names may contain slashes but never colons. */
    function parseDropPayload(payload: string): [string, string] | null {
        const at = payload.indexOf(':')
        if (at <= 0) return null
        return [payload.slice(0, at), payload.slice(at + 1)]
    }

    /** Cherry-pick `hash` onto `targetBranch`, checking out first when it isn't current. Always refreshes so conflicts paint. */
    async function cherryPickOnto(hash: string, targetBranch: string) {
        const short = hash.slice(0, 7)
        const switching = targetBranch !== props.repo.branch
        let mode: LocalChangesMode = 'keep'
        if (switching) {
            const resolved = await resolveCheckoutMode(targetBranch)
            if (!resolved) return
            mode = resolved
        }
        let status: { kind: 'ok' | 'warn' | 'unknown'; text: string }
        let willConflict = false
        try {
            const check = await uiTransient.withBusy(
                () => window.api.cherryPickCheck(hash, targetBranch),
                `Checking cherry-pick onto ${targetBranch}…`
            )
            willConflict = check.conflicts.length > 0
            status = !check.supported
                ? { kind: 'unknown', text: 'Conflict check unavailable' }
                : check.fastForward
                  ? { kind: 'warn', text: 'Already in this branch — pick would come out empty' }
                  : willConflict
                    ? { kind: 'warn', text: `Cherry-pick will cause conflicts — ${check.conflicts.length} file(s)` }
                    : { kind: 'ok', text: 'Can be picked without conflicts' }
        } catch {
            status = { kind: 'unknown', text: 'Conflict check unavailable' }
        }
        const ok = await confirmDialog({
            title: 'Cherry-pick commit',
            message: switching
                ? willConflict
                    ? `Will checkout "${targetBranch}" to resolve conflicts.`
                    : `Will checkout "${targetBranch}" first, then pick ${short} onto it.`
                : `Pick ${short} onto "${targetBranch}"?`,
            flow: { from: short, to: targetBranch, label: 'cherry-pick' },
            status,
            confirmLabel: 'Cherry-pick',
        })
        if (!ok) return
        try {
            await uiTransient.withBusy(async () => {
                if (switching) await window.api.checkout(targetBranch, mode)
                await window.api.cherryPick(hash)
                await props.refresh()
            }, `Cherry-picking onto ${targetBranch}…`)
            await notifyUndoable(props.repo.path, `Cherry-picked ${short} onto ${targetBranch}`)
        } catch (error) {
            // A conflict leaves unmerged files behind — refresh anyway so they paint instead of going stale.
            await props.refresh().catch(() => {})
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function handleDrop(targetBranch: string, event: DragEvent) {
        event.preventDefault()
        dropTarget.value = null
        if (uiTransient.busy) return
        const payload = event.dataTransfer?.getData('text/plain')
        const parsed = payload ? parseDropPayload(payload) : null
        if (!parsed) return
        const [kind, value] = parsed
        if (kind === 'commit') {
            // Dragging a commit onto a branch cherry-picks it there (hard reset stays in the commit context menu).
            if (!value.trim()) return
            void cherryPickOnto(value.trim(), targetBranch)
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
            void runUndoable(
                () => window.api.mergeInto(value, targetBranch),
                `Merged ${value} into ${targetBranch}`,
                `Merging ${value} into ${targetBranch}…`
            )
        }
    }
    function onDragOver(branchName: string, event: DragEvent) {
        if (event.dataTransfer?.types.includes('text/plain')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
            dropTarget.value = branchName
        }
    }
    function stripRemote(name: string) {
        return name.replace(/^(?:remotes\/)?[^/]+\//, '')
    }
</script>

<template>
    <aside
        class="sidebar"
        :style="{ width: `${ui.sidebarWidth}px`, flexBasis: `${ui.sidebarWidth}px` }">
        <div class="sidebar-toolbar">
            <img
                :src="canoIcon"
                alt="Git Cano"
                title="Git Cano"
                class="sidebar-brand-icon" />
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
                        :class="{
                            current: branch.current,
                            'drop-target': dropTarget === branch.name,
                            soloed: repoStore.soloBranch === branch.name,
                            dimmed: !!repoStore.soloBranch && repoStore.soloBranch !== branch.name,
                        }"
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
                        <button
                            v-if="repoStore.soloBranch === branch.name"
                            class="icon-btn solo-exit"
                            title="Unsolo (show all branches)"
                            @click.stop="repoStore.setSolo(null)">
                            <i-lucide-crosshair
                                width="14"
                                height="14" />
                        </button>
                        <span
                            v-if="!branch.current"
                            class="row-actions">
                            <button
                                v-if="!repoStore.soloBranch"
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
                        :class="{
                            current: isRemoteCurrent(branch.name),
                            soloed: repoStore.soloBranch === branch.name,
                            dimmed: !!repoStore.soloBranch && repoStore.soloBranch !== branch.name,
                        }"
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
                        <button
                            v-if="repoStore.soloBranch === branch.name"
                            class="icon-btn solo-exit"
                            title="Unsolo (show all branches)"
                            @click.stop="repoStore.setSolo(null)">
                            <i-lucide-crosshair
                                width="14"
                                height="14" />
                        </button>
                        <span class="row-actions">
                            <button
                                v-if="!repoStore.soloBranch"
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
                        v-if="loadingTags"
                        class="sidebar-empty">
                        <ThinkSpinner suffix="Loading tags…" />
                    </div>
                    <template v-else>
                        <div
                            v-if="loadingRemoteTags"
                            class="sidebar-empty">
                            <ThinkSpinner suffix="Loading remote tags…" />
                        </div>
                        <div
                            v-if="tags.length === 0 && !loadingRemoteTags"
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
                            <ThinkSpinner
                                v-if="pendingRemoteTag === tag.name"
                                compact
                                class="tag-remote-ic"
                                title="Working…" />
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
                    title="Git Cano version"
                    >Version: {{ appVersion }}</span
                >
                <span
                    v-if="appVersion && showUpdateButton"
                    class="app-version-divider"
                    aria-hidden="true" />
                <button
                    v-if="updater.status === 'available'"
                    class="toolbar-icon-button update-version-btn"
                    :title="updateButtonTitle"
                    @click="handleUpdateButtonClick">
                    <i-codicon-desktop-download
                        width="17"
                        height="17" />
                </button>
                <button
                    v-else-if="updater.status === 'downloading'"
                    class="toolbar-icon-button update-version-btn"
                    :title="`Downloading update… ${updater.progress}%`"
                    @click="handleUpdateVersionClick">
                    <ThinkSpinner compact />
                </button>
                <button
                    v-else-if="updater.status === 'downloaded'"
                    class="toolbar-icon-button update-version-btn"
                    :title="updateButtonTitle"
                    @click="handleUpdateButtonClick">
                    <i-lucide-check
                        width="17"
                        height="17" />
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
            @solo="branch => toggleSolo(branch.name)"
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
