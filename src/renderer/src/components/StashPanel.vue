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
    type FormMode = 'create' | 'rename' | 'duplicate'
    const form = ref<{ mode: FormMode; index?: number } | null>(null)
    const message = ref('')
    const menu = ref<StashMenuState | null>(null)

    const formTitle = computed(() =>
        form.value?.mode === 'rename' ? 'Rename stash' : form.value?.mode === 'duplicate' ? 'Duplicate stash' : 'New stash'
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

    function openForm(mode: FormMode, stash?: StashEntry) {
        expanded.value = true
        form.value = { mode, index: stash?.index }
        if (mode === 'create') message.value = ''
        else {
            const name = stash?.message.replace(/^On [^:]+: /, '') ?? ''
            message.value = mode === 'rename' ? name : `${name} (copy)`
        }
    }

    function closeForm() {
        form.value = null
        message.value = ''
    }

    function submitForm() {
        if (!form.value || !message.value.trim()) return
        const text = message.value.trim()
        if (form.value.mode === 'create') {
            void run(() => window.api.createStash(text, true), 'Changes stashed')
        } else if (form.value.mode === 'rename') {
            void run(() => window.api.renameStash(form.value!.index!, text), 'Stash renamed')
        } else {
            void run(() => window.api.duplicateStash(form.value!.index!, text), 'Stash duplicated')
        }
        closeForm()
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
                v-if="!form"
                class="icon-btn accent-icon"
                title="Create stash"
                @click="openForm('create')">
                <i-lucide-plus
                    width="15"
                    height="15" />
            </button>
        </div>
        <template v-if="expanded">
            <div
                v-if="form"
                class="stash-create">
                <input
                    v-model="message"
                    autofocus
                    :placeholder="formTitle"
                    @keydown.enter="submitForm()" />
                <div class="stash-create-actions">
                    <button
                        class="btn small"
                        @click="closeForm()">
                        Cancel
                    </button>
                    <button
                        :class="['btn small', form.mode === 'rename' ? 'warn' : 'primary']"
                        :disabled="!message.trim()"
                        @click="submitForm()">
                        <i-lucide-check
                            width="13"
                            height="13" />
                        {{ form.mode === 'rename' ? 'Rename' : 'Save' }}
                    </button>
                </div>
            </div>
            <div
                v-if="stashes.length === 0 && !form"
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
            @pop="onPop"
            @rename="stash => openForm('rename', stash)"
            @duplicate="stash => openForm('duplicate', stash)" />
    </div>
</template>
