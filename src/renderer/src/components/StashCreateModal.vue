<script setup lang="ts">
    import { nextTick, useTemplateRef, computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideArchive from '~icons/lucide/archive'
    import ILucideCheck from '~icons/lucide/check'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'

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
    <div class="confirm-dialog-overlay">
        <div class="confirm-dialog">
            <div class="confirm-dialog-header flow">
                <i-lucide-archive
                    width="17"
                    height="17" />
                <strong>Create stash</strong>
            </div>
            <div class="confirm-dialog-body">
                <input
                    ref="messageInput"
                    v-model="message"
                    class="prompt-input"
                    autofocus
                    placeholder="Stash message"
                    spellcheck="false"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <div
                    v-if="isDuplicate"
                    class="prompt-error">
                    Stash name already exists
                </div>
                <div
                    v-else-if="error"
                    class="prompt-error">
                    {{ error }}
                </div>
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    :disabled="busy"
                    @click="emit('close')">
                    Cancel
                </button>
                <button
                    class="btn primary"
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
</template>
