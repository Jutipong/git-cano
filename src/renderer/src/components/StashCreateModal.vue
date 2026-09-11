<script setup lang="ts">
    import { nextTick, useTemplateRef, computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideCheck from '~icons/lucide/check'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const repoStore = useRepoStore()
    const uiTransient = useUiTransientStore()

    const message = ref('')
    const existing = ref<string[]>([])
    const busy = ref(false)
    const error = ref('')
    const messageInput = useTemplateRef<HTMLInputElement>('messageInput')

    const normalizeMessage = (value: string) => value.replace(/^On [^:]+: /, '').trim()

    const isDuplicate = computed(() => {
        const text = normalizeMessage(message.value)
        return text.length > 0 && existing.value.some(stash => normalizeMessage(stash) === text)
    })

    onMounted(async () => {
        document.addEventListener('keydown', onKey)
        nextTick(() => messageInput.value?.focus())
        try {
            const stashes = await window.api.stashes()
            existing.value = stashes.map(stash => stash.message)
        } catch {}
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    async function submit() {
        const text = message.value.trim()
        if (!text || busy.value) return
        if (isDuplicate.value) {
            error.value = 'Stash name already exists'
            return
        }
        busy.value = true
        error.value = ''
        try {
            await uiTransient.withBusy(async () => {
                await window.api.createStash(text)
                await repoStore.refresh()
            }, 'Creating stash…')
            uiTransient.bumpStashList()
            notify('Changes stashed', 'success')
            emit('close')
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busy.value = false
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal tag-modal">
            <div class="rebase-modal-header">
                <strong>Create stash</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="tag-modal-body">
                <input
                    ref="messageInput"
                    v-model="message"
                    autofocus
                    placeholder="Stash message"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <div
                    v-if="isDuplicate"
                    class="tag-modal-error">
                    Stash name already exists
                </div>
                <div
                    v-else-if="error"
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
                        :disabled="!message.trim() || isDuplicate || busy"
                        @click="submit()">
                        <i-lucide-check
                            width="13"
                            height="13" />
                        Save
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
