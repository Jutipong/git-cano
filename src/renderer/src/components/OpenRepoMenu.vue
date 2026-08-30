<script setup lang="ts">
    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'

    const props = withDefaults(
        defineProps<{
            label?: string
        }>(),
        { label: '' }
    )
    const emit = defineEmits<{ (e: 'clone'): void }>()

    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()
    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const open = ref(false)

    function toggle() {
        open.value = !open.value
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
            title="Open from local or clone a repository"
            @click="toggle()">
            <i-lucide-plus
                width="15"
                height="15" />
        </button>
        <button
            v-else
            class="btn primary"
            @click="toggle()">
            <i-lucide-plus
                width="15"
                height="15" />
            {{ props.label }}
        </button>
        <div
            v-if="open"
            class="open-repo-pop">
            <button
                class="open-repo-item"
                title="Pick a folder from your local disk"
                @click="openLocal()">
                <i-lucide-folder-open
                    width="13"
                    height="13" />
                <span>Open from local</span>
            </button>
            <button
                class="open-repo-item"
                title="Clone a remote repository into a new folder"
                @click="openClone()">
                <i-lucide-download
                    width="13"
                    height="13" />
                <span>Clone from URL</span>
            </button>
        </div>
    </div>
</template>