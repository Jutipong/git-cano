<script setup lang="ts">
    import { computed, inject, onMounted, ref, watch, type Component } from 'vue'
    import VisualStudio from '~icons/catppuccin/visual-studio'
    import VisualStudioCode from '~icons/catppuccin/vscode'
    import Folder from '~icons/catppuccin/folder'
    import Bash from '~icons/catppuccin/bash'
    import Rider from '~icons/logos/rider'
    import ArrowDown from '~icons/lucide/arrow-down'
    import ArrowDownToLine from '~icons/lucide/arrow-down-to-line'
    import ArrowUp from '~icons/lucide/arrow-up'
    import FolderGit2 from '~icons/lucide/folder-git2'
    import FolderOpen from '~icons/lucide/folder-open'
    import GitBranch from '~icons/lucide/git-branch'
    import History from '~icons/lucide/history'
    import Layers from '~icons/lucide/layers'
    import Search from '~icons/lucide/search'
    import Settings from '~icons/lucide/settings'
    import Sparkles from '~icons/lucide/sparkles'
    import Terminal from '~icons/lucide/terminal'
    import Trash2 from '~icons/lucide/trash2'
    import X from '~icons/lucide/x'
    import Kiro from '~icons/thesvg-color/kiro'

    import { useAiStore } from '../stores/ai'
    import { useRepoStore } from '../stores/repo'
    import { useSyncStore } from '../stores/sync'
    import { useUiStore, type AiCommitMode } from '../stores/ui'
    import { useUiTransientStore, type NotifyOptions, type ToastKind } from '../stores/uiTransient'
    import { useWorkspaceStore } from '../stores/workspace'
    import { resolveCheckoutMode } from '../utils/checkout'
    import { fetchOpenInTargets, peekOpenInTargets } from '../utils/openIn'

    import type { BranchInfo, OpenInTargets } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void; (e: 'open-repo'): void; (e: 'toggle-terminal'): void; (e: 'terminate-all-terminals'): void }>()

    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()
    const syncStore = useSyncStore()
    const ui = useUiStore()
    const ai = useAiStore()
    const ws = useWorkspaceStore()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    type Mode = 'commands' | 'repo' | 'branch' | 'workspace'
    const mode = ref<Mode>('commands')
    const search = ref('')
    const active = ref(0)
    const input = ref<HTMLInputElement | null>(null)
    /** Fallback branch list for the rare case the store hasn't loaded one for the active repo yet. */
    const fetchedLocal = ref<BranchInfo[] | null>(null)
    /** Availability of conditional Open-in targets for the repo the palette was opened on. */
    const openInTargets = ref<OpenInTargets | null>(null)
    const openInPath = ref<string | null>(null)

    interface PaletteItem {
        id: string
        label: string
        hint?: string
        icon: Component
        /** Accent color matching the equivalent UI button (sync buttons / AI modes). */
        accent?: 'green' | 'orange' | 'red' | 'blue'
        run: () => void
    }

    onMounted(() => {
        input.value?.focus()
        loadOpenInTargets()
    })

    // The active repo can change while the palette is open (Ctrl+W closes a tab above the busy gate) —
    // the flattened Open-in items must follow it.
    watch(
        () => repoStore.repo?.path,
        () => loadOpenInTargets()
    )

    /** Preloads Open-in availability for the active repo so the flattened items can show immediately. */
    function loadOpenInTargets() {
        const repoPath = repoStore.repo?.path
        if (!repoPath) return
        openInPath.value = repoPath
        openInTargets.value = peekOpenInTargets(repoPath)
        void fetchOpenInTargets(repoPath)
            .then(result => {
                if (openInPath.value === repoPath) openInTargets.value = result
            })
            .catch(() => {})
    }

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

    async function checkoutBranch(name: string) {
        close()
        const mode = await resolveCheckoutMode(name)
        if (!mode) return
        void (async () => {
            try {
                await uiTransient.withBusy(async () => {
                    await window.api.checkout(name, mode)
                    await repoStore.refresh()
                }, `Checking out ${name}…`)
                notify(`Checked out ${name}`, 'success')
            } catch (error) {
                notify(String(error).replace(/^Error:\s*/, ''), 'error')
            }
        })()
    }

    /**
     * Mirrors FilePanel's canGenerate — AI commands appear only when the AI button would be usable. (Committing/generating are busy-gated,
     * so the palette can't even open then.)
     */
    const aiCanRun = computed(
        () =>
            !!ai.configured && !!repoStore.repo && repoStore.repo.files.length > 0 && !repoStore.selectedCommit && !repoStore.selectedStash
    )

    /** Hands the AI run to FilePanel (which owns the message textarea + commit flow) as a one-shot mode request. */
    function requestAiRun(aiMode: AiCommitMode) {
        close()
        ui.aiRunRequest = aiMode
    }

    /** Switches workspace via the repo store (it owns the busy guard + switching splash), errors surface like WorkspaceButton's. */
    function switchWorkspace(name: string) {
        close()
        void (async () => {
            try {
                await repoStore.switchWorkspace(name)
            } catch (error) {
                notify(String(error).replace(/^Error:\s*/, ''), 'error')
            }
        })()
    }

    /** Mirrors OpenInButton's error handling — close first, then open the active repo externally. */
    function openExternal(action: (repoPath: string) => Promise<unknown>) {
        const repoPath = repoStore.repo?.path
        if (!repoPath) return
        close()
        action(repoPath).catch((error: unknown) => notify(String(error).replace(/^Error:\s*/, ''), 'error'))
    }

    const commandItems = computed<PaletteItem[]>(() => {
        const items: PaletteItem[] = []
        if (repoStore.repo) {
            items.push(
                { id: 'pull', label: 'Pull', accent: 'blue', icon: ArrowDown, run: () => execute(() => syncStore.pull(repoStore.refreshWithTags)) },
                { id: 'push', label: 'Push', accent: 'green', icon: ArrowUp, run: () => execute(() => syncStore.push(repoStore.refresh)) },
                {
                    id: 'fetch',
                    label: 'Fetch',
                    accent: 'orange',
                    icon: ArrowDownToLine,
                    run: () => execute(() => syncStore.fetch(repoStore.refreshWithTags)),
                }
            )
        }
        items.push(
            { id: 'repo', label: 'Repo…', hint: 'Switch repository tab', icon: FolderGit2, run: () => enterMode('repo') },
            { id: 'branch', label: 'Branch…', hint: 'Checkout branch', icon: GitBranch, run: () => enterMode('branch') },
            // Flattened top-level commands: no "Open in…" / "AI…" sub-mode to drill into.
            ...(repoStore.repo ? openInItems.value : []),
            ...(ws.names.length > 1
                ? [
                      {
                          id: 'workspace',
                          label: 'Workspace…',
                          hint: 'Switch workspace',
                          icon: Layers,
                          run: () => enterMode('workspace'),
                      } satisfies PaletteItem,
                  ]
                : []),
            ...(aiCanRun.value ? aiItems.value : []),
            {
                id: 'openRepo',
                label: 'Open repository',
                icon: FolderOpen,
                run: () => {
                    close()
                    emit('open-repo')
                },
            },
            ...(repoStore.repo
                ? [
                      {
                          id: 'reflog',
                          label: 'Reflog',
                          hint: 'Recover lost history',
                          icon: History,
                          run: () => {
                              close()
                              repoStore.reflogOpen = true
                          },
                      } satisfies PaletteItem,
                      {
                          id: 'terminal',
                          label: 'Terminal',
                          hint: 'Show/hide terminal panel',
                          icon: Terminal,
                          run: () => {
                              close()
                              emit('toggle-terminal')
                          },
                      } satisfies PaletteItem,
                  ]
                : []),
            // Not repo-gated on purpose: shells parked in another workspace still count, and
            // terminating them all is exactly the escape hatch a workspace switch no longer provides.
            ...(repoStore.terminalCount > 0
                ? [
                      {
                          id: 'terminal-terminate-all',
                          label: 'Terminate all terminals',
                          hint: `Terminate ${repoStore.terminalCount} terminal${repoStore.terminalCount > 1 ? 's' : ''} in every repo`,
                          icon: Trash2,
                          accent: 'red',
                          run: () => {
                              close()
                              emit('terminate-all-terminals')
                          },
                      } satisfies PaletteItem,
                  ]
                : []),
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

    const workspaceItems = computed<PaletteItem[]>(() =>
        ws.names.map(name => ({
            id: name,
            label: name,
            hint: name === ws.active ? 'Active' : undefined,
            icon: Layers,
            run: () => {
                close()
                if (name !== ws.active) switchWorkspace(name)
            },
        }))
    )

    const aiItems = computed<PaletteItem[]>(() => [
        { id: 'aiGenerate', label: 'AI: Generate message', accent: 'green', icon: Sparkles, run: () => requestAiRun('off') },
        {
            id: 'aiGenerateCommit',
            label: 'AI: Generate message & commit',
            accent: 'orange',
            icon: Sparkles,
            run: () => requestAiRun('commit'),
        },
        {
            id: 'aiGenerateCommitPush',
            label: 'AI: Generate message & commit & push',
            accent: 'red',
            icon: Sparkles,
            run: () => requestAiRun('commit-push'),
        },
    ])

    /** Same options/conditions as OpenInButton, driven by the active repo path. */
    const openInItems = computed<PaletteItem[]>(() => {
        if (!repoStore.repo) return []
        const items: PaletteItem[] = [
            {
                id: 'openin-folder',
                label: 'Open in: Folder',
                icon: Folder,
                run: () => openExternal(path => window.api.openInFolder(path)),
            },
            {
                id: 'openin-terminal',
                label: 'Open in: Terminal',
                icon: Bash,
                run: () => openExternal(path => window.api.openTerminal(path)),
            },
            {
                id: 'openin-vscode',
                label: 'Open in: VS Code',
                icon: VisualStudioCode,
                run: () => openExternal(path => window.api.openInVSCode(path)),
            },
        ]
        if (openInTargets.value?.kiro) {
            items.push({
                id: 'openin-kiro',
                label: 'Open in: Kiro',
                icon: Kiro,
                run: () => openExternal(path => window.api.openInKiro(path)),
            })
        }
        if (openInTargets.value?.visualStudio) {
            items.push({
                id: 'openin-visualstudio',
                label: 'Open in: Visual Studio',
                icon: VisualStudio,
                run: () => openExternal(path => window.api.openInVisualStudio(path)),
            })
        }
        if (openInTargets.value?.rider) {
            items.push({
                id: 'openin-rider',
                label: 'Open in: Rider',
                icon: Rider,
                run: () => openExternal(path => window.api.openInRider(path)),
            })
        }
        return items
    })

    const items = computed<PaletteItem[]>(() =>
        mode.value === 'repo'
            ? repoItems.value
            : mode.value === 'branch'
              ? branchItems.value
              : mode.value === 'workspace'
                ? workspaceItems.value
                : commandItems.value
    )

    /** Like-style filter: case-insensitive substring match on the item label. */
    const filtered = computed(() => {
        const query = search.value.trim().toLowerCase()
        if (!query) return items.value
        return items.value.filter(item => item.label.toLowerCase().includes(query))
    })

    watch(filtered, () => (active.value = 0))
    watch(active, () => document.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' }))

    const PLACEHOLDERS: Record<Mode, string> = {
        commands: 'Type a command…',
        repo: 'Search repo…',
        branch: 'Search branch…',
        workspace: 'Search workspace…',
    }
    const EMPTY_TEXTS: Record<Mode, string> = {
        commands: 'No matching command',
        repo: 'No matching repository',
        branch: 'No matching branch',
        workspace: 'No matching workspace',
    }
    const placeholder = computed(() => PLACEHOLDERS[mode.value])
    const emptyText = computed(() => EMPTY_TEXTS[mode.value])

    const CHIP: Record<Exclude<Mode, 'commands'>, { icon: Component; label: string }> = {
        repo: { icon: FolderGit2, label: 'Repo' },
        branch: { icon: GitBranch, label: 'Branch' },
        workspace: { icon: Layers, label: 'Workspace' },
    }

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
                        :is="CHIP[mode].icon"
                        width="11"
                        height="11" />
                    <span>{{ CHIP[mode].label }}</span>
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
                    :class="[{ active: index === active }, item.accent ? `accent-${item.accent}` : '']"
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
