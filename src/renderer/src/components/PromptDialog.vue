<script setup lang="ts">
    import { usePromptStore } from '../stores/prompt'

    const promptStore = usePromptStore()
    const input = ref<HTMLInputElement | null>(null)
    const value = ref('')
    const error = ref('')

    const REF_NAME_FORBIDDEN = /[\s~^:?*[\]\\]/

    const existing = computed(() => promptStore.current?.existing ?? [])
    const isDuplicate = computed(() => {
        const trimmed = value.value.trim()
        return trimmed.length > 0 && existing.value.includes(trimmed)
    })

    const blocked = computed(() => !value.value.trim() || isDuplicate.value)

    function submit() {
        const trimmed = value.value.trim()
        if (!trimmed) {
            error.value = 'Enter a name'
            return
        }
        if (REF_NAME_FORBIDDEN.test(trimmed)) {
            error.value = 'Name contains invalid characters'
            return
        }
        if (isDuplicate.value) {
            error.value = `${trimmed} already exists`
            return
        }
        promptStore.settle(trimmed)
    }

    function onKey(event: KeyboardEvent) {
        if (!promptStore.current) return
        if (event.key === 'Escape') promptStore.settle(null)
        else if (event.key === 'Enter') submit()
    }

    watch(
        () => promptStore.current,
        current => {
            value.value = current?.defaultValue ?? ''
            error.value = ''
            if (current) input.value?.focus()
        },
        { flush: 'post' }
    )

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        v-if="promptStore.current"
        class="confirm-dialog-overlay"
        @mousedown.self="promptStore.settle(null)">
        <div class="confirm-dialog">
            <div class="confirm-dialog-header">
                <i-lucide-git-branch
                    width="17"
                    height="17" />
                <strong>{{ promptStore.current.title }}</strong>
            </div>
            <div class="confirm-dialog-body">
                <pre v-if="promptStore.current.message">{{ promptStore.current.message }}</pre>
                <input
                    ref="input"
                    v-model="value"
                    class="prompt-input"
                    :placeholder="promptStore.current.placeholder ?? ''"
                    spellcheck="false"
                    @input="error = ''" />
                <span
                    v-if="error || isDuplicate"
                    class="prompt-error"
                    >{{ error || `${value.trim()} already exists` }}</span
                >
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    @click="promptStore.settle(null)">
                    Cancel
                </button>
                <button
                    class="btn primary"
                    :disabled="blocked"
                    @click="submit()">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    {{ promptStore.current.confirmLabel ?? 'OK' }}
                </button>
            </div>
        </div>
    </div>
</template>
