<script setup lang="ts">
    import type { StashEntry } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    import { useTemplateRef } from 'vue'
    import { formatCommitDate } from '../utils/format'
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
    const creating = ref(false)
    const message = ref('')
    const menu = ref<StashMenuState | null>(null)
    const messageInput = useTemplateRef<HTMLInputElement>('messageInput')

    /** stash messages get a baked-in "On <branch>: " prefix; strip it so the
     *  duplicate check matches what the user actually types */
    const normalizeMessage = (value: string) => value.replace(/^On [^:]+: /, '').trim()

    /** true when the typed message already exists on an existing stash */
    const isDuplicate = computed(() => {
        const text = normalizeMessage(message.value)
        return text.length > 0 && stashes.value.some(stash => normalizeMessage(stash.message) === text)
    })

    /** display rows: message without the "On <branch>: " prefix, date + branch */
    const stashRows = computed(() =>
        stashes.value.map(stash => {
            const match = /^On ([^:]+): /.exec(stash.message)
            const branch = match ? match[1] : ''
            return {
                stash,
                text: stash.message.replace(/^On [^:]+: /, '').trim(),
                meta: branch ? `${formatCommitDate(stash.date)} | branch: ${branch}` : formatCommitDate(stash.date),
            }
        })
    )

    /** focus the message input as soon as the create form mounts */
    watch(
        creating,
        value => {
            if (value) messageInput.value?.focus()
        },
        { flush: 'post' }
    )

    async function load() {
        try {
            stashes.value = await window.api.stashes()
        } catch {
            /* ignore */
        }
    }
    onMounted(load)
    watch(() => props.repoPath, load)

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
        if (!message.value.trim() || isDuplicate.value) return
        const text = message.value.trim()
        void run(() => window.api.createStash(text), 'Changes stashed', 'Creating stash…')
        closeCreate()
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
            <button
                v-if="!creating"
                class="icon-btn accent-green"
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
                    ref="messageInput"
                    v-model="message"
                    :class="{ 'input-error': isDuplicate }"
                    placeholder="Stash message"
                    @keydown.enter="submitCreate()"
                    @keydown.escape.stop="closeCreate()" />
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
