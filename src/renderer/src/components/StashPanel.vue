<script setup lang="ts">
    import type { StashEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

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
    const menu = ref<StashMenuState | null>(null)

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
    }

    function submitCreate() {
        if (!message.value.trim()) return
        const text = message.value.trim()
        void run(() => window.api.createStash(text, true), 'Changes stashed')
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

    function formatDate(value: string): string {
        const date = new Date(value)
        return Number.isNaN(date.getTime())
            ? value
            : date.toLocaleString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
              })
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
                    placeholder="Stash message"
                    @keydown.enter="submitCreate()" />
                <div class="stash-create-actions">
                    <button
                        class="btn small"
                        @click="closeCreate()">
                        Cancel
                    </button>
                    <button
                        class="btn primary small"
                        :disabled="!message.trim()"
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
                    <strong>{{ stash.message.replace(/^On [^:]+: /, '') }}</strong>
                    <span>{{ formatDate(stash.date) }}</span>
                </div>
                <div class="stash-actions">
                    <button
                        class="icon-btn danger"
                        title="Drop"
                        @click="dropStash(stash)">
                        <i-lucide-trash2
                            width="14"
                            height="14" />
                    </button>
                </div>
            </div>
        </template>
        <StashContextMenu
            :menu="menu"
            @close="menu = null"
            @apply="onApply"
            @pop="onPop" />
    </div>
</template>
