<script setup lang="ts">
    import { useTemplateRef } from 'vue'

    const confirmStore = useConfirmStore()
    const confirmBtn = useTemplateRef<HTMLButtonElement>('confirmBtn')

    const conflict = computed(() => confirmStore.current?.status?.kind === 'warn')
    const forcePush = computed(() => confirmStore.current?.confirmIcon === 'force-push')

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
            <div
                class="confirm-dialog-header"
                :class="{ orange: forcePush }">
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
                    <span
                        class="confirm-flow-wire"
                        :class="{ conflict, 'can-merge': !conflict }">
                        <svg
                            viewBox="0 0 100 2"
                            preserveAspectRatio="none"
                            aria-hidden="true">
                            <template v-if="!conflict">
                                <path
                                    class="confirm-flow-lane"
                                    d="M1 1 H 99"
                                    vector-effect="non-scaling-stroke" />
                            </template>
                            <template v-else>
                                <path
                                    class="confirm-flow-lane"
                                    d="M1 1 H 44"
                                    vector-effect="non-scaling-stroke" />
                                <path
                                    class="confirm-flow-blocked"
                                    d="M56 1 H 99"
                                    vector-effect="non-scaling-stroke" />
                            </template>
                        </svg>
                        <span
                            v-if="!conflict"
                            class="confirm-flow-arrow"
                            aria-hidden="true" />
                        <svg
                            v-else
                            class="confirm-flow-clash"
                            viewBox="0 0 28 16"
                            aria-hidden="true">
                            <path d="M1 8 H 9" />
                            <path d="M9 4 L 13 8 L 9 12" />
                            <path d="M27 8 H 19" />
                            <path d="M19 4 L 15 8 L 19 12" />
                        </svg>
                    </span>
                    <span
                        class="confirm-flow-chip target"
                        :class="{ conflict }">
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
                    Cancel
                </button>
                <button
                    ref="confirmBtn"
                    class="btn"
                    :class="forcePush ? 'orange' : confirmStore.current.danger ? 'danger' : 'primary'"
                    @click="confirmStore.settle(true)">
                    <i-lucide-zap
                        v-if="confirmStore.current.confirmIcon === 'force-push'"
                        width="13"
                        height="13" />
                    <i-lucide-rotate-ccw
                        v-else-if="confirmStore.current.confirmIcon === 'reset'"
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
