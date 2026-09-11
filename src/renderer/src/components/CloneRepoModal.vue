<script setup lang="ts">
    import { nextTick, useTemplateRef, computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideFolderPlus from '~icons/lucide/folder-plus'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()

    const url = ref('')
    const dest = ref('')
    const busy = ref(false)
    const pickingDest = ref(false)
    const error = ref('')
    const urlInput = useTemplateRef<HTMLInputElement>('urlInput')

    const folderName = computed(() => {
        const urlText = url.value.trim()
        const namePart = urlText.split('/').pop() || urlText
        return namePart.replace(/\.git$/i, '')
    })

    const canSubmit = computed(() => url.value.trim().length > 0 && dest.value.length > 0 && !busy.value && !pickingDest.value)

    onMounted(() => {
        document.addEventListener('keydown', onKey)
        nextTick(() => urlInput.value?.focus())
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    async function pickDest() {
        if (pickingDest.value) return
        pickingDest.value = true
        error.value = ''
        try {
            const dir = await window.api.pickDirectory()
            if (dir) dest.value = dir
        } catch {
        } finally {
            pickingDest.value = false
        }
    }

    async function submit() {
        const trimmedUrl = url.value.trim()
        if (!canSubmit.value) return
        busy.value = true
        error.value = ''
        try {
            const status = await uiTransient.withBusy(() => window.api.clone(trimmedUrl, dest.value), 'Cloning repository…')
            if (status) {
                repoStore.addTab(status)
                notify('Repository cloned', 'success')
                emit('close')
            }
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busy.value = false
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal clone-modal">
            <div class="rebase-modal-header">
                <strong>Clone repository</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="tag-modal-body clone-modal-body">
                <input
                    ref="urlInput"
                    v-model="url"
                    autofocus
                    placeholder="Repository URL (https://github.com/user/repo.git)"
                    spellcheck="false"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <span class="clone-dest-label">Destination folder</span>
                <button
                    type="button"
                    class="clone-dest-field"
                    :class="{ 'has-value': !!dest }"
                    :disabled="pickingDest"
                    @click="pickDest()">
                    <i-lucide-folder-plus
                        width="14"
                        height="14" />
                    <span class="clone-dest-text">{{ dest || (pickingDest ? 'Choosing folder…' : 'Choose destination folder') }}</span>
                </button>
                <div
                    v-if="dest && url.trim()"
                    class="clone-dest-hint">
                    Will clone into {{ dest }}/{{ folderName }}
                </div>
                <div
                    v-if="error"
                    class="tag-modal-error">
                    {{ error }}
                </div>
                <div class="stash-create-actions tag-modal-actions">
                    <button
                        class="btn small"
                        :disabled="busy"
                        @click="emit('close')">
                        Cancel
                    </button>
                    <button
                        class="btn primary small"
                        :disabled="!canSubmit"
                        @click="submit()">
                        <i-lucide-download
                            width="13"
                            height="13" />
                        Clone
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
