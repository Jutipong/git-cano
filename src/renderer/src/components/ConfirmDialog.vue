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
                <div
                    v-if="confirmStore.current.flow"
                    class="confirm-flow">
                    <span class="confirm-flow-chip">
                        <i-lucide-git-branch
                            width="12"
                            height="12" />
                        {{ confirmStore.current.flow.from }}
                    </span>
                    <span class="confirm-flow-wire">
                        <svg
                            viewBox="0 0 100 26"
                            preserveAspectRatio="none"
                            aria-hidden="true">
                            <path
                                class="confirm-flow-lane-from"
                                d="M2 6 C 36 6 42 20 68 20"
                                vector-effect="non-scaling-stroke" />
                            <path
                                class="confirm-flow-lane-to"
                                d="M2 20 H 88"
                                vector-effect="non-scaling-stroke" />
                            <circle
                                class="confirm-flow-dot"
                                cx="72"
                                cy="20"
                                r="3" />
                            <path
                                class="confirm-flow-lane-to"
                                d="M84 15 L 91 20 L 84 25"
                                vector-effect="non-scaling-stroke" />
                        </svg>
                        <em>{{ confirmStore.current.flow.label ?? 'merge into' }}</em>
                    </span>
                    <span class="confirm-flow-chip target">
                        <i-lucide-git-branch
                            width="12"
                            height="12" />
                        {{ confirmStore.current.flow.to }}
                    </span>
                </div>
                <div
                    v-if="confirmStore.current.status"
                    class="confirm-status"
                    :class="`confirm-status-${confirmStore.current.status.kind}`">
                    <i-lucide-check
                        v-if="confirmStore.current.status.kind === 'ok'"
                        width="14"
                        height="14" />
                    <i-lucide-alert-triangle
                        v-else-if="confirmStore.current.status.kind === 'warn'"
                        width="14"
                        height="14" />
                    <i-lucide-info
                        v-else
                        width="14"
                        height="14" />
                    <span>{{ confirmStore.current.status.text }}</span>
                </div>
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
                    <i-lucide-rotate-ccw
                        v-if="confirmStore.current.confirmIcon === 'reset'"
                        width="13"
                        height="13" />
                    <i-lucide-trash2
                        v-else-if="confirmStore.current.danger"
                        width="13"
                        height="13" />
                    {{ confirmStore.current.confirmLabel ?? 'Confirm' }}
                </button>
            </div>
        </div>
    </div>
</template>
