<script setup lang="ts">
    import { GitCommitHorizontal, RotateCcw } from 'lucide-vue-next'

    import type { CommitDetails as CommitDetailsData, CommitNode } from '@shared/types'

    const props = defineProps<{ commit: CommitNode; notify: (message: string) => void }>()
    const refresh = inject<() => Promise<unknown>>('refresh', async () => {})

    const details = ref<CommitDetailsData | null>(null)

    watch(
        () => props.commit.hash,
        async () => {
            details.value = null
            try {
                details.value = await window.api.commitDetails(props.commit.hash)
            } catch (error) {
                useUiStore().notify(String(error).replace(/^Error:\s*/, ''))
            }
        },
        { immediate: true }
    )

    function checkoutCommit() {
        void run('Checked out commit (detached HEAD)', () => window.api.checkoutCommit(props.commit.hash))
    }
    function cherryPick() {
        void run('Cherry-picked', () => window.api.cherryPick(props.commit.hash))
    }
    function checkoutNow() {
        void run('Checked out commit (detached HEAD)', () => window.api.checkoutCommit(props.commit.hash))
    }
    function cherryPickNow() {
        void run('Cherry-picked', () => window.api.cherryPick(props.commit.hash))
    }
    function revertCommit() {
        if (!window.confirm(`Revert commit ${props.commit.shortHash}?`)) return
        void run('Commit reverted', () => window.api.revertCommit(props.commit.hash))
    }

    async function run(label: string, fn: () => Promise<unknown>) {
        try {
            await fn()
            await refresh()
            props.notify(label)
        } catch (error) {
            useUiStore().notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    const message = computed(() => details.value?.message || props.commit.subject)
    const summary = computed(() => message.value.split('\n')[0])
    const body = computed(() => message.value.split('\n').slice(2).join('\n').trim())

    function formatDate(value: string): string {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return value
        return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    }
</script>

<template>
    <section class="commit-details">
        <div class="commit-details-heading">
            <div class="commit-details-title">
                <GitCommitHorizontal :size="16" />
                <strong>Commit details</strong>
            </div>
            <span class="commit-details-hash">{{ commit.shortHash }}</span>
        </div>
        <div class="commit-details-content">
            <div class="commit-details-summary">{{ summary }}</div>
            <div
                v-if="body"
                class="commit-details-body">
                {{ body }}
            </div>
            <div class="commit-meta">
                <span>{{ details?.author || commit.author }}</span>
                <span>{{ formatDate(details?.date || commit.date) }}</span>
                <span>{{ details ? `${details.files.length} changed files` : 'Loading…' }}</span>
            </div>
            <div class="commit-ref-list">
                <span
                    v-for="ref in commit.refs"
                    :key="ref"
                    class="ref-chip"
                    >{{ ref }}</span
                >
                <span
                    v-if="commit.parents.length"
                    class="parent-meta">
                    Parent {{ commit.parents[0].slice(0, 7) }}
                </span>
                <span class="commit-detail-actions">
                    <button
                        class="detail-action"
                        title="Checkout this commit"
                        @click="checkoutCommit()">
                        Checkout
                    </button>
                    <button
                        class="detail-action"
                        title="Cherry-pick onto current branch"
                        @click="cherryPick()">
                        Cherry-pick
                    </button>
                    <button
                        class="detail-action danger"
                        title="Revert this commit"
                        @click="revertCommit()">
                        <RotateCcw :size="12" /> Revert
                    </button>
                </span>
            </div>
        </div>
    </section>
</template>
