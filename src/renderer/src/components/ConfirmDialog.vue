<script setup lang="ts">
    import { useTemplateRef } from 'vue'

    const confirmStore = useConfirmStore()
    const confirmBtn = useTemplateRef<HTMLButtonElement>('confirmBtn')

    function onKey(event: KeyboardEvent) {
        if (!confirmStore.current) return
        if (event.key === 'Escape') confirmStore.settle(false)
        else if (event.key === 'Enter') confirmStore.settle(true)
    }

    watch(
        () => confirmStore.current,
        value => {
            if (value) confirmBtn.value?.focus()
        },
        { flush: 'post' }
    )

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        v-if="confirmStore.current"
        class="confirm-dialog-overlay"
        @mousedown.self="confirmStore.settle(false)">
        <div class="confirm-dialog">
            <div class="confirm-dialog-header">
                <i-lucide-alert-triangle
                    v-if="confirmStore.current.danger"
                    width="17"
                    height="17" />
                <strong>{{ confirmStore.current.title ?? 'Confirm' }}</strong>
            </div>
            <div class="confirm-dialog-body">
                <pre>{{ confirmStore.current.message }}</pre>
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    @click="confirmStore.settle(false)">
                    <i-lucide-x
                        width="13"
                        height="13" />
                    Cancel
                </button>
                <button
                    ref="confirmBtn"
                    class="btn"
                    :class="confirmStore.current.danger ? 'danger' : 'primary'"
                    @click="confirmStore.settle(true)">
                    <i-lucide-trash2
                        v-if="confirmStore.current.danger"
                        width="13"
                        height="13" />
                    {{ confirmStore.current.confirmLabel ?? 'Confirm' }}
                </button>
            </div>
        </div>
    </div>
</template>