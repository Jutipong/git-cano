<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore } from '../stores/uiTransient'
    import { notifyUndoable } from '../utils/undo'
    import CloseXIcon from './CloseXIcon.vue'

    import type { CommitNode, SquashPlan } from '@shared/types'

    const props = defineProps<{ commit: CommitNode }>()
    const emit = defineEmits<{ (e: 'close'): void; (e: 'complete', message: string): void }>()
    const repoStore = useRepoStore()

    const plan = ref<SquashPlan | null>(null)
    const message = ref('')
    const error = ref('')
    const loading = ref(true)
    const busy = ref(false)

    const titleLen = computed(() => (message.value.split('\n')[0] ?? '').length)
    const titleHint = computed(() => {
        if (titleLen.value > 72) return 'over 72 — consider shortening'
        if (titleLen.value > 50) return 'over 50 — still fine'
        return `${titleLen.value}/50`
    })
    /** Newest first, like the graph — the last row is the oldest commit whose message is kept. */
    const newestFirst = computed(() => (plan.value ? [...plan.value.commits].reverse() : []))

    onMounted(async () => {
        document.addEventListener('keydown', onKey)
        try {
            plan.value = await window.api.squashPlan(props.commit.hash)
            message.value = plan.value.defaultMessage
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

    async function submit() {
        if (!plan.value || busy.value || !message.value.trim() || plan.value.dirty) return
        busy.value = true
        error.value = ''
        try {
            await useUiTransientStore().withBusy(() => window.api.squashCommits(plan.value!.base, message.value), 'Squashing…')
            await repoStore.refresh()
            await notifyUndoable(repoStore.repo?.path, `Squashed ${plan.value.commits.length} commits`)
            emit('complete', `Squashed ${plan.value.commits.length} commits`)
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busy.value = false
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal squash-modal">
            <div class="rebase-modal-header">
                <strong>Squash {{ plan ? `${plan.commits.length} into 1` : 'commits' }}</strong>
                <code class="rebase-base">onto {{ plan ? plan.base.slice(0, 7) : commit.shortHash }}</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div
                v-if="loading"
                class="rebase-loading">
                Loading commits…
            </div>
            <div
                v-else-if="!plan"
                class="rebase-error">
                {{ error || 'Could not load squash plan' }}
            </div>
            <div
                v-else
                class="squash-body">
                <div class="squash-note">
                    {{ plan.commits.length }} commits become 1 on top of {{ plan.base.slice(0, 7) }} — every commit in between is included,
                    skipping is not possible.
                </div>
                <div
                    v-if="plan.dirty"
                    class="squash-warn">
                    Commit or stash your changes first — the worktree must be clean to squash.
                </div>
                <div class="squash-list">
                    <div
                        v-for="(c, i) in newestFirst"
                        :key="c.hash"
                        class="squash-row">
                        <code class="rebase-hash">{{ c.shortHash }}</code>
                        <span class="squash-subject">{{ c.subject }}</span>
                        <span
                            v-if="i === 0"
                            class="squash-badge head">
                            HEAD
                        </span>
                        <span
                            v-if="i === newestFirst.length - 1"
                            class="squash-badge keep">
                            keeps message
                        </span>
                    </div>
                </div>
                <label class="squash-label">
                    Commit message
                    <span
                        class="squash-count"
                        :class="{ over: titleLen > 72 }"
                        >{{ titleHint }}</span
                    >
                </label>
                <textarea
                    v-model="message"
                    class="squash-message"
                    rows="4"
                    placeholder="Squashed commit message"
                    @input="error = ''" />
                <div
                    v-if="error"
                    class="tag-modal-error">
                    {{ error }}
                </div>
                <div class="stash-create-actions tag-modal-actions">
                    <button
                        class="btn small"
                        :disabled="busy"
                        @click="emit('close')">
                        Cancel
                    </button>
                    <button
                        class="btn primary small"
                        :disabled="!message.trim() || busy || plan.dirty"
                        @click="submit()">
                        {{ busy ? 'Squashing…' : `Squash ${plan.commits.length} commits` }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
