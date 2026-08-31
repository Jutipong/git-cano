<script setup lang="ts">
    import ChevronRight from '~icons/lucide/chevron-right'
    import File from '~icons/lucide/file'
    import Files from '~icons/lucide/files'
    import Folder from '~icons/lucide/folder'
    import History from '~icons/lucide/history'
    import ScanSearch from '~icons/lucide/scan-search'

    import type { ToastKind } from '../stores/uiTransient'

    export interface FileMenuState {
        x: number
        y: number
        path: string
        directory?: boolean
        untracked?: boolean
        deleted?: boolean
    }

    const props = defineProps<{
        menu: FileMenuState | null
        refresh: () => Promise<unknown>
    }>()
    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'show-history', path: string): void
        (e: 'show-blame', path: string): void
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const root = ref<HTMLElement | null>(null)
    const submenuLeft = computed(() => (props.menu?.x ?? 0) > window.innerWidth - 430)

    const fileName = computed(() => props.menu?.path.split('/').pop() ?? '')
    const fileExtension = computed(() => {
        const path = props.menu?.path ?? ''
        const name = path.split('/').pop() ?? ''
        const dot = name.lastIndexOf('.')
        return dot > 0 && dot < name.length - 1 ? `.${name.slice(dot + 1)}` : null
    })

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

    function menuStyle() {
        if (!props.menu) return {}
        return {
            left: `${Math.max(8, Math.min(props.menu.x, window.innerWidth - 250))}px`,
            top: `${Math.max(8, Math.min(props.menu.y, window.innerHeight - 190))}px`,
        }
    }

    function act(kind: 'history' | 'blame') {
        const menu = props.menu
        if (!menu || menu.directory || menu.untracked) return
        if (kind === 'blame' && menu.deleted) return
        emit('close')
        if (kind === 'history') emit('show-history', menu.path)
        else emit('show-blame', menu.path)
    }

    async function addIgnoreRule(rule: string) {
        const menu = props.menu
        if (!menu) return
        emit('close')
        try {
            await window.api.addIgnoreRule(rule)
            await props.refresh()
            notify(`Added ${rule} to .gitignore. Tracked files remain tracked.`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }
</script>

<template>
    <div
        v-if="menu"
        ref="root"
        class="file-context-menu"
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
        <div class="file-context-menu-separator" />
        <div class="file-context-menu-wrap">
            <button
                class="file-context-menu-item has-sub"
                type="button">
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
            <div class="file-context-menu-sub">
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
