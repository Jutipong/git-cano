<script setup lang="ts">
    import { Archive, Check, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
    import { onMounted, ref, watch } from 'vue'

    import type { StashEntry } from '@shared/types'

    const props = defineProps<{ repoPath: string; refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    const stashes = ref<StashEntry[]>([])
    const expanded = ref(true)
    const creating = ref(false)
    const message = ref('')

    async function load() {
        try {
            stashes.value = await window.api.stashes()
        } catch {
            /* ignore */
        }
    }
    onMounted(load)
    watch(() => props.repoPath, load)

    async function run(fn: () => Promise<unknown>, ok: string) {
        try {
            await fn()
            await load()
            await props.refresh()
            notify(ok)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function create() {
        await run(() => window.api.createStash(message.value.trim() || 'WIP', true), 'Changes stashed')
        message.value = ''
        creating.value = false
    }

    function applyStash(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, false), 'Stash applied')
    }
    function popStash(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, true), 'Stash popped')
    }
    function dropStash(stash: StashEntry) {
        if (!window.confirm(`Drop ${stash.message}?`)) return
        void run(() => window.api.dropStash(stash.index), 'Stash dropped')
    }

    function formatDate(value: string): string {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
</script>

<template>
    <div class="sidebar-section stash-section">
        <div class="section-header">
            <button
                class="section-toggle"
                @click="expanded = !expanded">
                <ChevronDown
                    v-if="expanded"
                    :size="13" />
                <ChevronRight
                    v-else
                    :size="13" />
                <h3>
                    <Archive :size="13" /> STASHES <span>{{ stashes.length }}</span>
                </h3>
            </button>
            <button
                class="icon-btn accent-icon"
                title="Create stash"
                @click="
                    () => {
                        expanded = true
                        creating = true
                    }
                ">
                <Plus :size="15" />
            </button>
        </div>
        <template v-if="expanded">
            <div
                v-if="creating"
                class="stash-create">
                <input
                    v-model="message"
                    autofocus
                    placeholder="Stash message"
                    @keydown.enter="create()" />
                <div class="stash-create-actions">
                    <button
                        class="btn primary small"
                        @click="create()">
                        <Check :size="13" /> Save
                    </button>
                    <button
                        class="btn small"
                        @click="creating = false">
                        Cancel
                    </button>
                </div>
            </div>
            <div
                v-if="stashes.length === 0 && !creating"
                class="sidebar-empty">
                No stashes
            </div>
            <div
                v-for="stash in stashes"
                :key="`${stash.hash}-${stash.index}`"
                class="stash-row">
                <div class="stash-copy">
                    <strong>{{ stash.message.replace(/^On [^:]+: /, '') }}</strong>
                    <span>{{ formatDate(stash.date) }}</span>
                </div>
                <div class="stash-actions">
                    <button
                        class="icon-btn"
                        title="Apply"
                        @click="applyStash(stash)">
                        Apply
                    </button>
                    <button
                        class="icon-btn"
                        title="Pop"
                        @click="popStash(stash)">
                        Pop
                    </button>
                    <button
                        class="icon-btn danger"
                        title="Drop"
                        @click="dropStash(stash)">
                        <Trash2 :size="13" />
                    </button>
                </div>
            </div>
        </template>
    </div>
</template>
