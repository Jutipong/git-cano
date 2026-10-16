<script setup lang="ts">
    import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideFolderPlus from '~icons/lucide/folder-plus'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'

    import { cloneFolderError, extractRepoFolderName, isValidCloneFolderName, joinClonePath } from '@shared/clone'
    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()

    const url = ref('')
    const parent = ref('')
    const folder = ref('')
    const folderEdited = ref(false)
    const busy = ref(false)
    const pickingParent = ref(false)
    const loadingRoot = ref(true)
    const error = ref('')
    const urlInput = useTemplateRef<HTMLInputElement>('urlInput')

    const folderProblem = computed(() => (folder.value ? cloneFolderError(folder.value) : 'Folder name is required'))
    const fullPath = computed(() => {
        if (!parent.value.trim() || !folder.value.trim()) return ''
        return joinClonePath(parent.value, folder.value)
    })

    const canSubmit = computed(
        () =>
            url.value.trim().length > 0 &&
            parent.value.trim().length > 0 &&
            isValidCloneFolderName(folder.value) &&
            !busy.value &&
            !pickingParent.value &&
            !loadingRoot.value,
    )

    watch(url, () => {
        error.value = ''
        if (!folderEdited.value) folder.value = extractRepoFolderName(url.value)
    })

    onMounted(() => {
        document.addEventListener('keydown', onKey)
        nextTick(() => urlInput.value?.focus())
        window.api
            .getLastCloneRoot()
            .then(root => {
                if (root) parent.value = root
            })
            .catch(() => {})
            .finally(() => {
                loadingRoot.value = false
            })
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    function onFolderInput() {
        folderEdited.value = true
        error.value = ''
    }

    function resetFolder() {
        folder.value = extractRepoFolderName(url.value)
        folderEdited.value = false
        error.value = ''
    }

    async function pickParent() {
        if (pickingParent.value) return
        pickingParent.value = true
        error.value = ''
        try {
            const dir = await window.api.pickDirectory()
            if (dir) parent.value = dir
        } catch {
        } finally {
            pickingParent.value = false
        }
    }

    async function submit() {
        if (!canSubmit.value) return
        busy.value = true
        error.value = ''
        try {
            const status = await uiTransient.withBusy(
                () => window.api.clone(url.value.trim(), parent.value.trim(), folder.value.trim()),
                'Cloning repository…',
            )
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
                <span class="clone-dest-label">Root folder</span>
                <button
                    type="button"
                    class="clone-dest-field"
                    :class="{ 'has-value': !!parent }"
                    :disabled="pickingParent || loadingRoot"
                    @click="pickParent()">
                    <i-lucide-folder-plus
                        width="14"
                        height="14" />
                    <span class="clone-dest-text">{{
                        parent || (loadingRoot ? 'Loading last folder…' : pickingParent ? 'Choosing folder…' : 'Choose root folder')
                    }}</span>
                </button>
                <span class="clone-dest-label">Folder name</span>
                <div class="clone-folder-row">
                    <input
                        v-model="folder"
                        placeholder="repo-folder"
                        spellcheck="false"
                        autocomplete="off"
                        @input="onFolderInput()"
                        @keydown.enter="submit()" />
                    <button
                        v-if="folderEdited"
                        type="button"
                        class="btn small"
                        title="Reset to name from URL"
                        @click="resetFolder()">
                        <i-lucide-rotate-ccw
                            width="13"
                            height="13" />
                    </button>
                </div>
                <div
                    v-if="fullPath"
                    class="clone-dest-hint">
                    Will clone into {{ fullPath }}
                </div>
                <div
                    v-if="folderProblem && (folder || url.trim())"
                    class="tag-modal-error">
                    {{ folderProblem }}
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
