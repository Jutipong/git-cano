<script setup lang="ts">
    import { useTemplateRef, computed, onBeforeUnmount, onMounted } from 'vue'
    import ILucideAlertTriangle from '~icons/lucide/alert-triangle'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideGitBranch from '~icons/lucide/git-branch'
    import ILucideGitMerge from '~icons/lucide/git-merge'
    import ILucideInfo from '~icons/lucide/info'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import ILucideTrash2 from '~icons/lucide/trash2'
    import ILucideZap from '~icons/lucide/zap'

    import { useConfirmStore } from '../stores/confirm'
    import { useModalA11y } from '../utils/modalA11y'
    import AppCheckbox from './AppCheckbox.vue'

    const confirmStore = useConfirmStore()
    const confirmBtn = useTemplateRef<HTMLButtonElement>('confirmBtn')
    const dialog = useTemplateRef<HTMLElement>('dialog')

    const conflict = computed(() => confirmStore.current?.status?.kind === 'warn')
    const forcePush = computed(() => confirmStore.current?.confirmIcon === 'force-push')
    const checked = computed({
        get: () => confirmStore.current?.checked ?? false,
        set: value => {
            if (confirmStore.current) confirmStore.current.checked = value
        },
    })

    function onKey(event: KeyboardEvent) {
        if (!confirmStore.current || event.key !== 'Enter') return
        // Let the focused button handle its own Enter (Cancel must cancel, not confirm).
        if (event.target instanceof Element && event.target.closest('button')) return
        event.preventDefault()
        confirmStore.settle(true)
    }

    useModalA11y({
        active: () => !!confirmStore.current,
        container: dialog,
        initialFocus: confirmBtn,
        onClose: () => confirmStore.settle(false),
    })

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        v-if="confirmStore.current"
        class="confirm-dialog-overlay">
        <div
            ref="dialog"
            class="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
            tabindex="-1">
            <div
                class="confirm-dialog-header"
                :class="{ orange: forcePush, flow: confirmStore.current.flow && !confirmStore.current.danger, conflict }">
                <i-lucide-git-merge
                    v-if="confirmStore.current.flow && !confirmStore.current.danger"
                    width="16"
                    height="16"
                    aria-hidden="true" />
                <i-lucide-alert-triangle
                    v-else-if="confirmStore.current.danger"
                    width="17"
                    height="17"
                    aria-hidden="true" />
                <strong id="confirm-dialog-title">{{ confirmStore.current.title ?? 'Confirm' }}</strong>
            </div>
            <div class="confirm-dialog-body">
                <div
                    v-if="confirmStore.current.flow"
                    class="confirm-flow">
                    <span class="confirm-flow-chip">
                        <i-lucide-git-branch
                            width="12"
                            height="12"
                            aria-hidden="true" />
                        {{ confirmStore.current.flow.from }}
                    </span>
                    <span
                        class="confirm-flow-wire"
                        :class="{
                            conflict,
                            danger: confirmStore.current.danger && !conflict,
                            'can-merge': !conflict && !confirmStore.current.danger,
                        }">
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
                        <span
                            v-else
                            class="confirm-flow-warn"
                            title="Blocked — needs a manual resolve"
                            aria-hidden="true">
                            <i-lucide-alert-triangle
                                width="11"
                                height="11" />
                        </span>
                    </span>
                    <span
                        class="confirm-flow-chip target"
                        :class="{ conflict, danger: confirmStore.current.danger && !conflict }">
                        <i-lucide-git-branch
                            width="12"
                            height="12"
                            aria-hidden="true" />
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
                        height="14"
                        aria-hidden="true" />
                    <i-lucide-alert-triangle
                        v-else-if="confirmStore.current.status.kind === 'warn'"
                        width="14"
                        height="14"
                        aria-hidden="true" />
                    <i-lucide-info
                        v-else
                        width="14"
                        height="14"
                        aria-hidden="true" />
                    <span>{{ confirmStore.current.status.text }}</span>
                </div>
                <pre id="confirm-dialog-message">{{ confirmStore.current.message }}</pre>
                <AppCheckbox
                    v-if="confirmStore.current.checkOption"
                    v-model="checked"
                    class="prompt-option">
                    {{ confirmStore.current.checkOption.label }}
                </AppCheckbox>
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
                        height="13"
                        aria-hidden="true" />
                    <i-lucide-rotate-ccw
                        v-else-if="confirmStore.current.confirmIcon === 'reset'"
                        width="13"
                        height="13"
                        aria-hidden="true" />
                    <i-lucide-trash2
                        v-else-if="confirmStore.current.danger"
                        width="13"
                        height="13"
                        aria-hidden="true" />
                    {{ confirmStore.current.confirmLabel ?? 'Confirm' }}
                </button>
            </div>
        </div>
    </div>
</template>
