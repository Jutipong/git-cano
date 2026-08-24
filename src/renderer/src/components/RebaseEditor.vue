<script setup lang="ts">
    import { ArrowDown, ArrowUp, PauseCircle, Play, Trash2, X } from 'lucide-vue-next'
    import { computed, ref, watch } from 'vue'

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
    const emit = defineEmits<{ (e: 'cancel'): void; (e: 'complete', message: string): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    const COMMANDS: RebaseCommand[] = ['pick', 'reword', 'squash', 'fixup', 'edit', 'split', 'drop']
    const EDITABLE_COMMANDS: RebaseCommand[] = ['reword', 'squash']

    const entries = ref<Entry[] | null>(null)
    const running = ref(false)
    const pausedMessage = ref<string | null>(null)
    const remaining = ref<Entry[]>([])
    const error = ref<string | null>(null)

    const activeCount = computed(() => entries.value?.filter(entry => entry.command !== 'drop').length ?? 0)

    watch(pausedMessage, value => {
        if (!value) return
        // freeze list while paused; unfreeze reloads nothing but stops editing
    })

    async function loadPlan() {
        try {
            const commits = await window.api.rebasePlan(props.baseRef)
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

    async function executePlan(plan: Entry[], resume: boolean) {
        running.value = true
        error.value = null
        try {
            const outcome = await window.api.rebaseExecute(
                props.baseRef,
                plan.map(entry => ({ command: entry.command, hash: entry.hash, message: entry.message })),
                resume
            )
            if (outcome.completed) {
                emit('complete', outcome.message)
            } else {
                pausedMessage.value = outcome.message
                remaining.value = plan
            }
        } catch (error_) {
            error.value = String(error_).replace(/^Error:\s*/, '')
        } finally {
            running.value = false
        }
    }

    function start() {
        if (!entries.value) return
        void executePlan(entries.value, false)
    }
    function continueRebase() {
        void executePlan(remaining.value, true)
    }
    async function abortPaused() {
        try {
            await window.api.rebaseAbortPaused()
            emit('complete', 'Rebase aborted — original state restored')
        } catch (error_) {
            error.value = String(error_).replace(/^Error:\s*/, '')
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
    <div
        class="modal-overlay"
        @mousedown.self="!running && !pausedMessage && emit('cancel')">
        <div class="rebase-modal">
            <div class="rebase-modal-header">
                <strong>Interactive rebase onto</strong>
                <code class="rebase-base">{{ baseRef }}</code>
                <span class="spacer" />
                <button
                    v-if="!pausedMessage"
                    class="icon-btn"
                    :disabled="running"
                    @click="emit('cancel')">
                    <X :size="16" />
                </button>
            </div>

            <div
                v-if="error"
                class="rebase-error">
                {{ error }}
            </div>

            <div
                v-if="pausedMessage"
                class="rebase-paused">
                <PauseCircle :size="18" />
                <div>
                    <strong>{{ pausedMessage }}</strong>
                    <p>Make your changes and commit them normally (the commit box works), then press Continue.</p>
                </div>
                <span class="spacer" />
                <button
                    class="btn small danger"
                    @click="abortPaused()">
                    Abort
                </button>
                <button
                    class="btn primary small"
                    @click="continueRebase()">
                    <Play :size="13" /> Continue rebase
                </button>
            </div>

            <div
                v-if="!entries && !error && !pausedMessage"
                class="rebase-loading">
                Loading commits…
            </div>
            <div
                v-if="entries && entries.length === 0 && !pausedMessage"
                class="rebase-loading">
                No commits between HEAD and {{ baseRef }}
            </div>

            <div
                v-if="entries && entries.length > 0"
                class="rebase-list"
                :class="{ frozen: pausedMessage }">
                <div
                    v-for="(entry, index) in entries"
                    :key="entry.hash"
                    class="rebase-row"
                    :class="{ dropped: entry.command === 'drop' }">
                    <select
                        v-model="entry.command"
                        class="rebase-command"
                        :class="`c-${entry.command}`"
                        :disabled="running || Boolean(pausedMessage)">
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
                        :disabled="running || Boolean(pausedMessage) || !EDITABLE_COMMANDS.includes(entry.command)" />
                    <span class="rebase-author">{{ entry.author }}</span>
                    <button
                        class="icon-btn"
                        title="Move up"
                        :disabled="running || Boolean(pausedMessage) || index === 0"
                        @click="move(index, -1)">
                        <ArrowUp :size="13" />
                    </button>
                    <button
                        class="icon-btn"
                        title="Move down"
                        :disabled="running || Boolean(pausedMessage) || index === entries.length - 1"
                        @click="move(index, 1)">
                        <ArrowDown :size="13" />
                    </button>
                    <button
                        class="icon-btn"
                        :class="entry.command === 'drop' ? 'accent-icon' : 'danger'"
                        :title="entry.command === 'drop' ? 'Restore commit' : 'Drop commit'"
                        :disabled="running || Boolean(pausedMessage)"
                        @click="update(index, { command: entry.command === 'drop' ? 'pick' : 'drop' })">
                        <Plus
                            v-if="entry.command === 'drop'"
                            :size="13" />
                        <Trash2
                            v-else
                            :size="13" />
                    </button>
                </div>
            </div>

            <div
                v-if="!pausedMessage"
                class="rebase-modal-footer">
                <span class="rebase-hint"> edit: pause here to amend · split: uncommit &amp; stage changes to split into pieces </span>
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

<style scoped>
    /* keep type-only import used for RebaseEntry in script */
</style>
