<script setup lang="ts">
    import { inject, onMounted, onUnmounted, ref } from 'vue'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideFolderOpen from '~icons/lucide/folder-open'
    import ILucidePlus from '~icons/lucide/plus'

    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUiTransientStore, type NotifyOptions, type ToastKind } from '../stores/uiTransient'
    import { formatCombo } from '../utils/shortcuts'

    const props = withDefaults(
        defineProps<{
            label?: string
        }>(),
        { label: '' }
    )
    const emit = defineEmits<{ (e: 'clone'): void }>()

    const repoStore = useRepoStore()
    const ui = useUiStore()
    const uiTransient = useUiTransientStore()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const open = ref(false)

    function toggle(event?: MouseEvent) {
        open.value = !open.value
        // drop the focus ring after a pointer click — the open state below
        // already shows the menu is active (keyboard focus is unaffected)
        if (event?.detail) (event.currentTarget as HTMLElement | null)?.blur()
    }

    async function openLocal() {
        open.value = false
        try {
            const status = await uiTransient.withBusy(() => window.api.pickAndOpen(), 'Opening repository…')
            if (status) repoStore.addTab(status)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function openClone() {
        open.value = false
        emit('clone')
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') open.value = false
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!open.value) return
        if ((event.target as HTMLElement | null)?.closest('.open-repo-wrap')) return
        open.value = false
    }

    onMounted(() => {
        document.addEventListener('pointerdown', onDocPointerDown)
        document.addEventListener('keydown', onKeydown)
    })
    onUnmounted(() => {
        document.removeEventListener('pointerdown', onDocPointerDown)
        document.removeEventListener('keydown', onKeydown)
    })
</script>

<template>
    <div class="open-repo-wrap">
        <button
            v-if="!props.label"
            class="icon-btn tab-new"
            :class="{ open }"
            title="Open from local or clone a repository"
            @click="toggle($event)">
            <i-lucide-plus
                width="15"
                height="15" />
        </button>
        <button
            v-else
            class="btn primary"
            :class="{ open }"
            @click="toggle()">
            <i-lucide-plus
                width="15"
                height="15" />
            {{ props.label }}
        </button>
        <div
            v-if="open"
            class="open-repo-pop"
            role="menu">
            <div class="open-repo-label">Open repository</div>
            <button
                class="open-repo-item"
                role="menuitem"
                title="Pick a folder from your local disk"
                @click="openLocal()">
                <span class="open-repo-icon">
                    <i-lucide-folder-open
                        width="14"
                        height="14" />
                </span>
                <span class="open-repo-text">
                    <span class="open-repo-title">Open from local</span>
                    <span class="open-repo-desc">Pick a folder from your disk</span>
                </span>
                <kbd class="open-repo-kbd">{{ formatCombo(ui.getShortcut('openRepo')) }}</kbd>
            </button>
            <button
                class="open-repo-item"
                role="menuitem"
                title="Clone a remote repository into a new folder"
                @click="openClone()">
                <span class="open-repo-icon">
                    <i-lucide-download
                        width="14"
                        height="14" />
                </span>
                <span class="open-repo-text">
                    <span class="open-repo-title">Clone from URL</span>
                    <span class="open-repo-desc">Download a remote repository</span>
                </span>
            </button>
        </div>
    </div>
</template>
