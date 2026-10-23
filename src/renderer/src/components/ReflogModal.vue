<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, onMounted, ref, useTemplateRef } from 'vue'
    import ILucideHistory from '~icons/lucide/history'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore } from '../stores/uiTransient'
    import { confirmDialog } from '../utils/confirm'
    import { formatCommitDate } from '../utils/format'
    import { handleListKeydown } from '../utils/listKeyboard'
    import { useModalA11y } from '../utils/modalA11y'
    import { notifyUndoable } from '../utils/undo'
    import CloseXIcon from './CloseXIcon.vue'

    import type { ReflogEntry } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const repoStore = useRepoStore()
    const dialog = useTemplateRef<HTMLElement>('dialog')

    useModalA11y({
        active: () => true,
        container: dialog,
        onClose: () => emit('close'),
    })

    const entries = ref<ReflogEntry[]>([])
    const loading = ref(true)
    const error = ref('')
    const busyIndex = ref<number | null>(null)

    const dirty = computed(() => (repoStore.repo?.files.length ?? 0) > 0)

    /** Rows bucketed by local day so long reflogs stay scannable. */
    const groups = computed(() => {
        const out: { key: string; label: string; entries: ReflogEntry[] }[] = []
        for (const entry of entries.value) {
            const key = dayKey(entry.date)
            const last = out.at(-1)
            if (last && last.key === key) last.entries.push(entry)
            else out.push({ key, label: dayLabel(entry.date), entries: [entry] })
        }
        return out
    })

    function dayKey(iso: string): string {
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) return iso
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    }

    function dayLabel(iso: string): string {
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) return iso
        const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
        const daysAgo = Math.round((midnight(new Date()) - midnight(date)) / 86_400_000)
        if (daysAgo === 0) return 'Today'
        if (daysAgo === 1) return 'Yesterday'
        if (daysAgo > 1 && daysAgo < 7) return date.toLocaleDateString(undefined, { weekday: 'long' })
        return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    }

    onMounted(async () => {
        try {
            entries.value = await window.api.reflog(200)
        } catch (err) {
            error.value = errorMessage(err)
        } finally {
            loading.value = false
        }
    })
    function activateReflogRow(row: HTMLElement): void {
        row.querySelector<HTMLButtonElement>('.reflog-restore:not([disabled])')?.click()
    }

    function actionLabel(action: string): string {
        return action.replace(/:$/, '').trim() || 'update'
    }

    /** Reflog action → timeline node / badge color. */
    function actionKind(action: string): string {
        const value = action.toLowerCase()
        if (value.includes('commit')) return 'commit'
        if (value.includes('reset')) return 'reset'
        if (value.includes('checkout')) return 'checkout'
        if (value.includes('rebase')) return 'rebase'
        if (value.includes('merge')) return 'merge'
        if (value.includes('cherry-pick') || value.includes('revert')) return 'cherry'
        if (value.includes('branch') || value.includes('clone') || value.includes('pull')) return 'branch'
        return 'other'
    }

    async function restore(entry: ReflogEntry) {
        if (busyIndex.value !== null || dirty.value) return
        const ok = await confirmDialog({
            title: 'Restore from reflog',
            message: `Move "${repoStore.repo?.branch}" back to ${entry.shortHash} (${entry.selector})?\nThe current tip is kept in the reflog — this is undoable.`,
            confirmLabel: 'Restore',
        })
        if (!ok) return
        busyIndex.value = entry.index
        error.value = ''
        try {
            await useUiTransientStore().withBusy(() => window.api.restoreReflog(entry.hash), `Restoring ${entry.shortHash}…`)
            await repoStore.refresh()
            entries.value = await window.api.reflog(200)
            await notifyUndoable(repoStore.repo?.path, `Restored to ${entry.shortHash}`)
        } catch (err) {
            error.value = errorMessage(err)
        } finally {
            busyIndex.value = null
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div
            ref="dialog"
            class="rebase-modal reflog-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reflog-modal-title"
            tabindex="-1">
            <div class="rebase-modal-header">
                <i-lucide-history
                    width="15"
                    height="15"
                    aria-hidden="true" />
                <strong id="reflog-modal-title">Reflog</strong>
                <code class="rebase-base">HEAD movement history</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    aria-label="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>

            <div
                v-if="dirty"
                class="squash-warn reflog-warn">
                Commit or stash your changes first — restoring moves the branch pointer and rewrites the worktree.
            </div>

            <div
                v-if="loading"
                class="rebase-loading">
                Loading reflog…
            </div>
            <div
                v-else-if="error && !entries.length"
                class="rebase-error">
                {{ error }}
            </div>
            <div
                v-else-if="!entries.length"
                class="rebase-loading">
                No reflog entries
            </div>

            <div
                v-else
                class="reflog-list"
                tabindex="0"
                role="listbox"
                aria-label="Reflog entries"
                @keydown="event => handleListKeydown(event, '.reflog-row', { onActivate: activateReflogRow })">
                <template
                    v-for="group in groups"
                    :key="group.key">
                    <div class="reflog-day">{{ group.label }}</div>
                    <div
                        v-for="(entry, position) in group.entries"
                        :key="entry.selector"
                        class="reflog-row"
                        tabindex="-1"
                        role="option"
                        :class="[`k-${actionKind(entry.action)}`, { current: entry.index === 0, first: position === 0 }]">
                        <span class="reflog-track">
                            <span class="reflog-node" />
                        </span>
                        <div class="reflog-body">
                            <div class="reflog-head">
                                <span class="reflog-action">{{ actionLabel(entry.action) }}</span>
                                <code class="reflog-selector">{{ entry.selector }}</code>
                                <code class="rebase-hash">{{ entry.shortHash }}</code>
                                <span class="spacer" />
                                <span
                                    v-if="entry.index === 0"
                                    class="reflog-badge current-badge"
                                    >current</span
                                >
                                <button
                                    v-else
                                    class="btn small reflog-restore"
                                    :disabled="dirty || busyIndex !== null"
                                    @click="restore(entry)">
                                    <i-lucide-rotate-ccw
                                        width="12"
                                        height="12" />
                                    {{ busyIndex === entry.index ? 'Restoring…' : 'Restore' }}
                                </button>
                            </div>
                            <div class="reflog-message">{{ entry.message || '—' }}</div>
                        </div>
                        <span
                            class="reflog-time"
                            :title="entry.date"
                            >{{ formatCommitDate(entry.date) }}</span
                        >
                    </div>
                </template>
            </div>

            <div
                v-if="error && entries.length"
                class="rebase-error reflog-error">
                {{ error }}
            </div>
        </div>
    </div>
</template>
