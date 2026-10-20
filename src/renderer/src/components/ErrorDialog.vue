<script setup lang="ts">
    import { useTemplateRef } from 'vue'
    import ILucideAlertTriangle from '~icons/lucide/alert-triangle'
    import ILucideCheck from '~icons/lucide/check'

    import { useModalA11y } from '../utils/modalA11y'
    import CloseXIcon from './CloseXIcon.vue'

    const props = defineProps<{ message: string | null }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const closeBtn = useTemplateRef<HTMLButtonElement>('closeBtn')
    const dialog = useTemplateRef<HTMLElement>('dialog')

    useModalA11y({
        active: () => !!props.message,
        container: dialog,
        initialFocus: closeBtn,
        onClose: () => emit('close'),
    })
</script>

<template>
    <div
        v-if="message"
        class="error-dialog-overlay">
        <div
            ref="dialog"
            class="error-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-live="assertive"
            aria-labelledby="error-dialog-title"
            aria-describedby="error-dialog-message"
            tabindex="-1">
            <div class="error-dialog-header">
                <i-lucide-alert-triangle
                    width="17"
                    height="17"
                    aria-hidden="true" />
                <strong id="error-dialog-title">Error</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    aria-label="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="error-dialog-body">
                <pre id="error-dialog-message">{{ message }}</pre>
            </div>
            <div class="error-dialog-actions">
                <button
                    ref="closeBtn"
                    class="btn primary"
                    @click="emit('close')">
                    <i-lucide-check
                        width="13"
                        height="13"
                        aria-hidden="true" />
                    Close
                </button>
            </div>
        </div>
    </div>
</template>
