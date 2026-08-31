<script setup lang="ts">
    import { useTemplateRef } from 'vue'

    const props = defineProps<{ message: string | null }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const closeBtn = useTemplateRef<HTMLButtonElement>('closeBtn')

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    watch(
        () => props.message,
        message => {
            if (message) closeBtn.value?.focus()
        },
        { flush: 'post' }
    )

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        v-if="message"
        class="error-dialog-overlay"
        role="alertdialog"
        aria-live="assertive">
        <div class="error-dialog">
            <div class="error-dialog-header">
                <i-lucide-alert-triangle
                    width="17"
                    height="17" />
                <strong>Error</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    @click="emit('close')">
                    <i-lucide-x
                        width="15"
                        height="15" />
                </button>
            </div>
            <div class="error-dialog-body">
                <pre>{{ message }}</pre>
            </div>
            <div class="error-dialog-actions">
                <button
                    ref="closeBtn"
                    class="btn primary"
                    @click="emit('close')">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    Close
                </button>
            </div>
        </div>
    </div>
</template>
