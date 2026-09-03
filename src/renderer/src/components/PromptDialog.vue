<script setup lang="ts">
    import { usePromptStore, type PromptResult } from '../stores/prompt'

    import type { LocalChangesMode } from '@shared/types'

    const promptStore = usePromptStore()
    const input = ref<HTMLInputElement | null>(null)
    const value = ref('')
    const error = ref('')
    const checkout = ref(true)
    const localChanges = ref<LocalChangesMode>('stash')

    const LOCAL_CHANGE_OPTIONS: { value: LocalChangesMode; label: string }[] = [
        { value: 'keep', label: "Don't change" },
        { value: 'stash', label: 'Stash and reapply' },
        { value: 'discard', label: 'Discard' },
    ]

    const REF_NAME_FORBIDDEN = /[\s~^:?*[\]\\]/

    const existing = computed(() => promptStore.current?.existing ?? [])
    const isBranch = computed(() => !!promptStore.current?.branchOptions)
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
        const result: PromptResult = {
            name: trimmed,
            checkout: isBranch.value ? checkout.value : false,
            localChanges: isBranch.value ? localChanges.value : 'keep',
        }
        promptStore.settle(result)
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
            checkout.value = current?.branchOptions?.checkout ?? true
            localChanges.value = current?.branchOptions?.localChanges ?? 'stash'
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
                <template v-if="isBranch">
                    <label class="prompt-option">
                        <input
                            v-model="checkout"
                            type="checkbox" />
                        Check out after create
                    </label>
                    <div
                        class="prompt-local-changes"
                        :class="{ disabled: !checkout }">
                        <span class="prompt-local-label">Local changes:</span>
                        <label
                            v-for="opt in LOCAL_CHANGE_OPTIONS"
                            :key="opt.value"
                            class="prompt-option">
                            <input
                                v-model="localChanges"
                                type="radio"
                                name="prompt-local-changes"
                                :value="opt.value"
                                :disabled="!checkout" />
                            {{ opt.label }}
                        </label>
                    </div>
                </template>
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
