<script setup lang="ts">
    import { computed, ref, watch } from 'vue'
    import ILucideArrowDown from '~icons/lucide/arrow-down'
    import ILucideArrowUp from '~icons/lucide/arrow-up'
    import ILucidePlus from '~icons/lucide/plus'
    import ILucideTrash2 from '~icons/lucide/trash2'

    import { useRepoStore } from '../stores/repo'
    import { useUiTransientStore } from '../stores/uiTransient'
    import CloseXIcon from './CloseXIcon.vue'

    import type { CommitNode, RebaseCommand } from '@shared/types'

    interface Entry {
        command: RebaseCommand
        hash: string
        shortHash: string
        author: string
        subject: string
        message: string
    }

    const props = defineProps<{ baseRef: string }>()
    const emit = defineEmits<{ (e: 'cancel'): void; (e: 'done', message: string): void; (e: 'paused', message: string): void }>()

    // Pin the repo the plan was loaded from: the modal can outlive a tab switch, and the rebase
    // must never run against whichever repo happens to be active at Start time.
    const repoPath = useRepoStore().repo?.path

    const COMMANDS: RebaseCommand[] = ['pick', 'reword', 'squash', 'fixup', 'edit', 'drop']
    const EDITABLE_COMMANDS: RebaseCommand[] = ['reword', 'squash']

    const entries = ref<Entry[] | null>(null)
    const running = ref(false)
    const error = ref<string | null>(null)

    const activeCount = computed(() => entries.value?.filter(entry => entry.command !== 'drop').length ?? 0)

    async function loadPlan() {
        try {
            const commits = await window.api.rebasePlan(props.baseRef, repoPath)
            entries.value = commits.map((commit: CommitNode) => ({
                command: 'pick' as RebaseCommand,
                hash: commit.hash,
                shortHash: commit.shortHash,
                author: commit.author,
                subject: commit.subject,
                message: commit.subject,
            }))
        } catch (error_) {
            error.value = String(error_).replace(/^Error:\s*/, '')
        }
    }

    watch(() => props.baseRef, loadPlan, { immediate: true })

    async function start() {
        const plan = entries.value
        if (!plan || running.value) return
        running.value = true
        error.value = null
        try {
            const outcome = await useUiTransientStore().withBusy(
                () =>
                    window.api.rebaseStart(
                        props.baseRef,
                        plan.map(entry => ({ command: entry.command, hash: entry.hash, message: entry.message })),
                        repoPath
                    ),
                'Rebasing…'
            )
            if (outcome.completed) emit('done', outcome.message)
            else emit('paused', outcome.message)
        } catch (error_) {
            error.value = String(error_).replace(/^Error:\s*/, '')
        } finally {
            running.value = false
        }
    }

    function update(index: number, patch: Partial<Entry>) {
        entries.value = entries.value?.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) ?? null
    }
    function move(index: number, delta: -1 | 1) {
        const current = entries.value
        if (!current) return
        const target = index + delta
        if (target < 0 || target >= current.length) return
        const next = [...current]
        ;[next[index], next[target]] = [next[target], next[index]]
        entries.value = next
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal">
            <div class="rebase-modal-header">
                <strong>Interactive rebase onto</strong>
                <code class="rebase-base">{{ baseRef }}</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    :disabled="running"
                    @click="emit('cancel')">
                    <CloseXIcon />
                </button>
            </div>

            <div
                v-if="error"
                class="rebase-error">
                {{ error }}
            </div>

            <div
                v-if="!entries && !error"
                class="rebase-loading">
                Loading commits…
            </div>
            <div
                v-if="entries && entries.length === 0"
                class="rebase-loading">
                No commits between HEAD and {{ baseRef }}
            </div>

            <div
                v-if="entries && entries.length > 0"
                class="rebase-list">
                <div
                    v-for="(entry, index) in entries"
                    :key="entry.hash"
                    class="rebase-row"
                    :class="{ dropped: entry.command === 'drop' }">
                    <select
                        v-model="entry.command"
                        class="rebase-command"
                        :class="`c-${entry.command}`"
                        :disabled="running">
                        <option
                            v-for="command in COMMANDS"
                            :key="command"
                            :value="command">
                            {{ command }}
                        </option>
                    </select>
                    <code class="rebase-hash">{{ entry.shortHash }}</code>
                    <input
                        v-model="entry.message"
                        class="rebase-message"
                        :placeholder="entry.subject"
                        :disabled="running || !EDITABLE_COMMANDS.includes(entry.command)" />
                    <span class="rebase-author">{{ entry.author }}</span>
                    <button
                        class="icon-btn danger"
                        title="Move up"
                        :disabled="running || index === 0"
                        @click="move(index, -1)">
                        <i-lucide-arrow-up
                            width="13"
                            height="13" />
                    </button>
                    <button
                        class="icon-btn"
                        title="Move down"
                        :disabled="running || index === entries.length - 1"
                        @click="move(index, 1)">
                        <i-lucide-arrow-down
                            width="13"
                            height="13" />
                    </button>
                    <button
                        class="icon-btn"
                        :class="entry.command === 'drop' ? 'accent-icon' : 'danger'"
                        :title="entry.command === 'drop' ? 'Restore commit' : 'Drop commit'"
                        :disabled="running"
                        @click="update(index, { command: entry.command === 'drop' ? 'pick' : 'drop' })">
                        <i-lucide-plus
                            v-if="entry.command === 'drop'"
                            width="13"
                            height="13" />
                        <i-lucide-trash2
                            v-else
                            width="13"
                            height="13" />
                    </button>
                </div>
            </div>

            <div class="rebase-modal-footer">
                <span class="rebase-hint"> edit: pause here to amend · conflicts pause the rebase and are resolved in the Changes panel </span>
                <span class="spacer" />
                <button
                    class="btn small"
                    :disabled="running"
                    @click="emit('cancel')">
                    Cancel
                </button>
                <button
                    class="btn primary small"
                    :disabled="!entries || entries.length === 0 || running"
                    @click="start()">
                    {{ running ? 'Rebasing…' : `Start rebase (${activeCount})` }}
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
