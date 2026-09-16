<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideGitBranch from '~icons/lucide/git-branch'

    import { useSwitchStore } from '../stores/switch'
    import { useUiStore } from '../stores/ui'
    import AppRadio from './AppRadio.vue'

    import type { LocalChangesMode } from '@shared/types'

    const switchStore = useSwitchStore()
    const ui = useUiStore()
    const localChanges = ref<LocalChangesMode>(ui.localChangesMode ?? 'stash')

    const LOCAL_CHANGE_OPTIONS: { value: LocalChangesMode; label: string }[] = [
        { value: 'keep', label: "Don't change" },
        { value: 'stash', label: 'Stash and reapply' },
        { value: 'discard', label: 'Discard' },
    ]

    function onKey(event: KeyboardEvent) {
        if (!switchStore.current) return
        if (event.key === 'Escape') switchStore.settle(null)
        else if (event.key === 'Enter') switchStore.settle(localChanges.value)
    }

    watch(
        () => switchStore.current,
        current => {
            if (current) localChanges.value = ui.localChangesMode ?? 'stash'
        },
        { flush: 'post' }
    )

    watch(localChanges, value => {
        ui.localChangesMode = value
    })

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        v-if="switchStore.current"
        class="confirm-dialog-overlay">
        <div class="confirm-dialog">
            <div class="confirm-dialog-header flow">
                <i-lucide-git-branch
                    width="17"
                    height="17" />
                <strong>Switch branch</strong>
            </div>
            <div class="confirm-dialog-body">
                <div class="switch-row">
                    <span class="prompt-local-label">Switch to:</span>
                    <span class="switch-target">
                        <i-lucide-git-branch
                            width="12"
                            height="12" />
                        {{ switchStore.current.branch }}
                    </span>
                </div>
                <div class="prompt-local-changes">
                    <span class="prompt-local-label">Local changes:</span>
                    <AppRadio
                        v-for="opt in LOCAL_CHANGE_OPTIONS"
                        :key="opt.value"
                        v-model="localChanges"
                        :value="opt.value"
                        name="switch-local-changes"
                        class="prompt-option">
                        {{ opt.label }}
                    </AppRadio>
                </div>
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    @click="switchStore.settle(null)">
                    Cancel
                </button>
                <button
                    class="btn primary"
                    @click="switchStore.settle(localChanges)">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    Switch
                </button>
            </div>
        </div>
    </div>
</template>
