<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideHistory from '~icons/lucide/history'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore } from '../stores/uiTransient'
    import { confirmDialog } from '../utils/confirm'
    import { formatCommitDate } from '../utils/format'
    import { notifyUndoable } from '../utils/undo'
    import CloseXIcon from './CloseXIcon.vue'

    import type { ReflogEntry } from '@shared/types'

    const emit = defineEmits<{ (e: 'close'): void }>()
    const repoStore = useRepoStore()

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
        document.addEventListener('keydown', onKey)
        try {
            entries.value = await window.api.reflog(200)
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            loading.value = false
        }
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
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
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busyIndex.value = null
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal reflog-modal">
            <div class="rebase-modal-header">
                <i-lucide-history
                    width="15"
                    height="15" />
                <strong>Reflog</strong>
                <code class="rebase-base">HEAD movement history</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
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
                class="reflog-list">
                <template
                    v-for="group in groups"
                    :key="group.key">
                    <div class="reflog-day">{{ group.label }}</div>
                    <div
                        v-for="(entry, position) in group.entries"
                        :key="entry.selector"
                        class="reflog-row"
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
