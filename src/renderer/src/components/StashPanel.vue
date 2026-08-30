<script setup lang="ts">
    import type { StashEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    import { formatDateTime } from '../utils/format'
    import { confirmDialog } from '../utils/confirm'
    import StashContextMenu, { type StashMenuState } from './StashContextMenu.vue'

    const props = defineProps<{ repoPath: string; refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const uiTransient = useUiTransientStore()

    const stashes = ref<StashEntry[]>([])
    const ui = useUiStore()
    const expanded = computed({
        get: () => ui.sidebarSections.stashes,
        set: value => {
            ui.sidebarSections.stashes = value
        },
    })
    const menu = ref<StashMenuState | null>(null)

    const normalizeMessage = (value: string) => value.replace(/^On [^:]+: /, '').trim()

    const stashRows = computed(() =>
        stashes.value.map(stash => {
            const match = /^On ([^:]+): /.exec(stash.message)
            const branch = match ? match[1] : ''
            return {
                stash,
                text: stash.message.replace(/^On [^:]+: /, '').trim(),
                meta: branch ? `${formatDateTime(stash.date)} | branch: ${branch}` : formatDateTime(stash.date),
            }
        })
    )

    async function load() {
        try {
            stashes.value = await window.api.stashes()
        } catch {
        }
    }
    onMounted(load)
    watch(() => props.repoPath, load)
    watch(() => uiTransient.stashListTick, load)

    async function run(fn: () => Promise<unknown>, ok: string, busyLabel = 'Working…') {
        try {
            await uiTransient.withBusy(fn, busyLabel)
            await load()
            await props.refresh()
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function dropStash(stash: StashEntry) {
        const ok = await confirmDialog({
            message: `Delete stashes: ${normalizeMessage(stash.message)}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        void run(() => window.api.dropStash(stash.index), 'Stash deleted', 'Dropping stash…')
    }

    function onApply(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, false), 'Stash applied', 'Applying stash…')
    }
    function onPop(stash: StashEntry) {
        void run(() => window.api.applyStash(stash.index, true), 'Stash popped', 'Popping stash…')
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
                    STASHES <span class="section-count">{{ stashes.length }}</span>
                </h3>
            </button>
        </div>
        <template v-if="expanded">
            <div
                v-if="stashes.length === 0"
                class="sidebar-empty">
                No stashes
            </div>
            <div
                v-for="row in stashRows"
                :key="`${row.stash.hash}-${row.stash.index}`"
                class="stash-row"
                @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, stash: row.stash }">
                <i-lucide-archive
                    width="13"
                    height="13" />
                <div class="stash-copy">
                    <strong :title="row.stash.message">{{ row.text }}</strong>
                    <span>{{ row.meta }}</span>
                </div>
                <span class="row-actions">
                    <button
                        class="icon-btn danger"
                        title="Delete stash"
                        @click.stop="void dropStash(row.stash)">
                        <i-lucide-trash2
                            width="14"
                            height="14" />
                    </button>
                </span>
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
