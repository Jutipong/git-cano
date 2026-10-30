<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type FunctionalComponent } from 'vue'
    import Rider from '~icons/devicon/rider'
    import VisualStudioCode from '~icons/devicon/vscode'
    import ChevronRight from '~icons/lucide/chevron-right'
    import Eye from '~icons/lucide/eye'
    import File from '~icons/lucide/file'
    import Files from '~icons/lucide/files'
    import Folder from '~icons/lucide/folder'
    import History from '~icons/lucide/history'
    import ScanSearch from '~icons/lucide/scan-search'
    import NotepadPlusPlus from '~icons/selfhst/notepad-plus-plus'
    import Kiro from '~icons/thesvg-color/kiro'
    import FileText from '~icons/withicons-suite/file-text'

    import { useMenuKeyboard } from '../utils/menuKeyboard'
    import { editorTargetOptions, fetchOpenInTargets, peekOpenInTargets } from '../utils/openIn'
    import { isPreviewablePath } from '../utils/preview'

    import type { ToastKind } from '../stores/uiTransient'

    import type { EditorTarget, OpenInTargets } from '@shared/types'

    export interface FileMenuState {
        x: number
        y: number
        path: string
        directory?: boolean
        untracked?: boolean
        deleted?: boolean
        /** False while viewing a commit's files — ignore rules only make sense for the worktree. */
        workdir?: boolean
        /** The worktree file is gone (staged or unstaged deletion), so there is nothing to open. */
        missingFromWorktree?: boolean
        /** Repo whose .gitignore receives the rule, pinned when the menu opened. */
        repoPath?: string
    }

    const props = defineProps<{
        menu: FileMenuState | null
        refresh: () => Promise<unknown>
    }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'show-history', path: string): void
        (e: 'show-blame', path: string): void
        (e: 'show-preview', path: string): void
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const root = ref<HTMLElement | null>(null)
    const submenuLeft = computed(() => (props.menu?.x ?? 0) > window.innerWidth - 430)
    const submenuOpen = ref(false)

    function close() {
        submenuOpen.value = false
        emit('close')
    }

    function focusSubmenuTrigger() {
        void nextTick(() => root.value?.querySelector<HTMLElement>('.file-context-menu-wrap > .has-sub')?.focus())
    }

    function focusSubmenuFirst() {
        void nextTick(() => root.value?.querySelector<HTMLElement>('.file-context-menu-sub button')?.focus())
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

    const fileName = computed(() => props.menu?.path.split('/').pop() ?? '')
    const fileExtension = computed(() => {
        const path = props.menu?.path ?? ''
        const name = path.split('/').pop() ?? ''
        const dot = name.lastIndexOf('.')
        return dot > 0 && dot < name.length - 1 ? `.${name.slice(dot + 1)}` : null
    })

    /** Read-only preview supports rendered markdown and pretty-printed JSON. */
    const isPreviewable = computed(() => {
        if (!props.menu || props.menu.directory || props.menu.deleted) return false
        return isPreviewablePath(props.menu.path)
    })

    const EDITOR_ICONS: Record<EditorTarget, FunctionalComponent> = {
        default: FileText,
        vscode: VisualStudioCode,
        rider: Rider,
        kiro: Kiro,
        notepadpp: NotepadPlusPlus,
    }
    const editorTargets = ref<OpenInTargets | null>(null)
    const editorOptions = computed(() => editorTargetOptions(editorTargets.value))
    const canOpenInEditor = computed(() => !!props.menu?.repoPath && !props.menu.directory && !props.menu.missingFromWorktree)

    watch(
        () => props.menu,
        menu => {
            if (!menu?.repoPath) {
                editorTargets.value = null
                return
            }
            const repoPath = menu.repoPath
            editorTargets.value = peekOpenInTargets(repoPath)
            void fetchOpenInTargets(repoPath)
                .then(result => {
                    if (props.menu?.repoPath === repoPath) editorTargets.value = result
                })
                .catch(() => {})
        },
        { immediate: true }
    )

    function onDocMouseDown(event: MouseEvent) {
        if (props.menu && root.value && !root.value.contains(event.target as Node)) close()
    }

    onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))

    function menuStyle() {
        const menu = props.menu
        if (!menu) return {}
        const itemCount =
            3 + (canOpenInEditor.value ? editorOptions.value.length : 0) + (menu.workdir && !menu.deleted ? 2 : 0)
        const estimatedHeight = 16 + itemCount * 29
        return {
            left: `${Math.max(8, Math.min(menu.x, window.innerWidth - 250))}px`,
            top: `${Math.max(8, Math.min(menu.y, window.innerHeight - estimatedHeight))}px`,
        }
    }

    function act(kind: 'history' | 'blame' | 'preview') {
        const menu = props.menu
        if (!menu || menu.directory) return
        if (kind === 'history' && menu.untracked) return
        if (kind === 'blame' && (menu.untracked || menu.deleted)) return
        if (kind === 'preview' && menu.deleted) return
        emit('close')
        if (kind === 'history') emit('show-history', menu.path)
        else if (kind === 'blame') emit('show-blame', menu.path)
        else emit('show-preview', menu.path)
    }

    function openInEditor(target: EditorTarget) {
        const menu = props.menu
        if (!menu?.repoPath) return
        emit('close')
        window.api.openFileInEditor(target, menu.repoPath, menu.path).catch(error => notify(errorMessage(error), 'error'))
    }

    async function addIgnoreRule(rule: string) {
        const menu = props.menu
        if (!menu) return
        emit('close')
        try {
            await window.api.addIgnoreRule(rule, menu.repoPath)
            await props.refresh()
            notify(`Added ${rule} to .gitignore. Tracked files remain tracked.`, 'success')
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="file-context-menu"
        role="menu"
        :class="{ 'submenu-left': submenuLeft }"
        :style="menuStyle()">
        <button
            class="file-context-menu-item"
            :disabled="menu.directory || menu.untracked"
            :title="menu.untracked ? 'Untracked files have no git history yet' : menu.directory ? 'Choose a file to view history' : ''"
            @click="act('history')">
            <History
                class="file-context-menu-icon"
                width="13"
                height="13" />
            View history
        </button>
        <button
            class="file-context-menu-item"
            :disabled="menu.directory || menu.untracked || menu.deleted"
            :title="
                menu.deleted
                    ? 'Deleted files cannot be blamed (no longer in working tree)'
                    : menu.untracked
                      ? 'Untracked files have no git history yet'
                      : menu.directory
                        ? 'Choose a file to view blame'
                        : ''
            "
            @click="act('blame')">
            <ScanSearch
                class="file-context-menu-icon"
                width="13"
                height="13" />
            Blame
        </button>
        <button
            v-if="isPreviewable"
            class="file-context-menu-item"
            :disabled="menu.directory || menu.deleted"
            :title="menu.deleted ? 'Deleted files cannot be previewed (no longer in working tree)' : ''"
            @click="act('preview')">
            <Eye
                class="file-context-menu-icon"
                width="13"
                height="13" />
            Preview
        </button>
        <template v-if="canOpenInEditor">
            <button
                v-for="option in editorOptions"
                :key="option.target"
                class="file-context-menu-item"
                :data-editor="option.target"
                :title="menu.workdir ? '' : `Open current working-tree file in ${option.label}`"
                @click="openInEditor(option.target)">
                <component
                    :is="EDITOR_ICONS[option.target]"
                    class="file-context-menu-icon"
                    width="13"
                    height="13" />
                Open in {{ option.label }}
            </button>
        </template>
        <div
            v-if="menu.workdir && !menu.deleted"
            class="file-context-menu-separator" />
        <div
            v-if="menu.workdir && !menu.deleted"
            class="file-context-menu-wrap"
            :class="{ 'keyboard-open': submenuOpen }">
            <button
                class="file-context-menu-item has-sub"
                type="button"
                aria-haspopup="menu"
                :aria-expanded="submenuOpen">
                <Folder
                    class="file-context-menu-icon"
                    width="13"
                    height="13" />
                Ignore
                <ChevronRight
                    class="file-context-menu-chevron"
                    width="12"
                    height="12" />
            </button>
            <div
                class="file-context-menu-sub"
                role="menu"
                aria-label="Ignore options">
                <button
                    v-if="!menu.directory"
                    class="file-context-menu-item"
                    @click="addIgnoreRule(menu.path)">
                    <File
                        class="file-context-menu-icon"
                        width="13"
                        height="13" />
                    Ignore {{ fileName }}
                </button>
                <button
                    v-if="!menu.directory && fileExtension"
                    class="file-context-menu-item"
                    @click="addIgnoreRule(`*${fileExtension}`)">
                    <Files
                        class="file-context-menu-icon"
                        width="13"
                        height="13" />
                    Ignore All {{ fileExtension }} Files...
                </button>
                <button
                    v-if="menu.directory"
                    class="file-context-menu-item"
                    @click="addIgnoreRule(`${menu.path}/`)">
                    <Folder
                        class="file-context-menu-icon"
                        width="13"
                        height="13" />
                    Ignore All Files in '{{ menu.path }}'...
                </button>
                <span
                    v-if="!menu.directory"
                    class="file-context-menu-note">
                    Tracked files are not untracked automatically.
                </span>
            </div>
        </div>
    </div>
</template>
