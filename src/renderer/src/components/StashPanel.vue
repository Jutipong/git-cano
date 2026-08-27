<script setup lang="ts">
    import type { StashEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    import { formatCommitDate } from '../utils/format'
    import StashContextMenu, { type StashMenuState } from './StashContextMenu.vue'

    const props = defineProps<{ repoPath: string; refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const stashes = ref<StashEntry[]>([])
    const ui = useUiStore()
    const expanded = computed({
        get: () => ui.sidebarSections.stashes,
        set: value => {
            ui.sidebarSections.stashes = value
        },
    })
    const creating = ref(false)
    const message = ref('')
    const includeUntracked = ref(true)
    const menu = ref<StashMenuState | null>(null)

    /** stash messages get a baked-in "On <branch>: " prefix; strip it so the
     *  duplicate check matches what the user actually types */
    const normalizeMessage = (value: string) => value.replace(/^On [^:]+: /, '').trim()

    /** true when the typed message already exists on an existing stash */
    const isDuplicate = computed(() => {
        const text = normalizeMessage(message.value)
        return text.length > 0 && stashes.value.some(stash => normalizeMessage(stash.message) === text)
    })

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
            notify(ok, 'stash')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function openCreate() {
        expanded.value = true
        creating.value = true
        message.value = ''
    }

    function closeCreate() {
        creating.value = false
        message.value = ''
        includeUntracked.value = true
    }

    function submitCreate() {
        if (!message.value.trim() || isDuplicate.value) return
        const text = message.value.trim()
        void run(() => window.api.createStash(text, includeUntracked.value), 'Changes stashed')
        closeCreate()
    }

    function dropStash(stash: StashEntry) {
        if (!window.confirm(`Drop ${stash.message}?`)) return
        void run(() => window.api.dropStash(stash.index), 'Stash dropped')
    }

    function onApply(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, false), 'Stash applied')
    }
    function onPop(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, true), 'Stash popped')
    }
</script>

<template>
    <div class="sidebar-section stash-section">
        <div class="section-header">
            <button
                class="section-toggle"
                @click="expanded = !expanded">
                <i-lucide-chevron-down
                    v-if="expanded"
                    width="13"
                    height="13" />
                <i-lucide-chevron-right
                    v-else
                    width="13"
                    height="13" />
                <h3>
                    <i-lucide-archive
                        width="13"
                        height="13" />
                    STASHES <span class="section-count">{{ stashes.length }}</span>
                </h3>
            </button>
            <button
                v-if="!creating"
                class="icon-btn accent-icon"
                title="Create stash"
                @click="openCreate()">
                <i-lucide-plus
                    width="15"
                    height="15" />
            </button>
        </div>
        <template v-if="expanded">
            <div
                v-if="creating"
                class="stash-create">
                <input
                    v-model="message"
                    autofocus
                    :class="{ 'input-error': isDuplicate }"
                    placeholder="Stash message"
                    @keydown.enter="submitCreate()"
                    @keydown.escape.stop="closeCreate()" />
                <label class="stash-create-check">
                    <input
                        v-model="includeUntracked"
                        type="checkbox" />
                    Include untracked files
                </label>
                <div
                    v-if="isDuplicate"
                    class="stash-error">
                    Stash name already exists
                </div>
                <div class="stash-create-actions">
                    <button
                        class="btn small"
                        @click="closeCreate()">
                        Cancel
                    </button>
                    <button
                        class="btn primary small"
                        :disabled="!message.trim() || isDuplicate"
                        @click="submitCreate()">
                        <i-lucide-check
                            width="13"
                            height="13" />
                        Save
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
                class="stash-row"
                @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, stash }">
                <div class="stash-copy">
                    <strong :title="stash.message">{{ stash.message }}</strong>
                    <span>{{ formatCommitDate(stash.date) }}</span>
                </div>
            </div>
        </template>
        <StashContextMenu
            :menu="menu"
            @close="menu = null"
            @apply="onApply"
            @pop="onPop"
            @drop="dropStash" />
    </div>
</template>
