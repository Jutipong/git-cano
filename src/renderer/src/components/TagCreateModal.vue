<script setup lang="ts">
    import type { CommitNode } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    import { useRepoStore } from '../stores/repo'

    const props = defineProps<{ commit: CommitNode }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const repoStore = useRepoStore()

    const name = ref('')
    const annotated = ref(false)
    const message = ref('')
    const existing = ref<string[]>([])
    const busy = ref(false)
    const error = ref('')

    onMounted(async () => {
        document.addEventListener('keydown', onKey)
        try {
            const tags = await window.api.tags()
            existing.value = tags.map(tag => tag.name)
        } catch {
            /* ignore — duplicate names still rejected by git */
        }
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    /** Short "head" of the target commit for the header chip — subject line only, capped. */
    const head = computed(() => {
        const s = props.commit.subject?.trim() ?? ''
        return s.length > 48 ? `${s.slice(0, 48).trimEnd()}…` : s
    })

    /** Git forbids whitespace and these characters in ref names. */
    const TAG_NAME_FORBIDDEN = /[\s~^:?*[\]\\]/

    /** true when the typed name already exists on an existing tag (live, like stash) */
    const isDuplicate = computed(() => {
        const trimmed = name.value.trim()
        return trimmed.length > 0 && existing.value.includes(trimmed)
    })

    async function submit() {
        const trimmed = name.value.trim()
        if (!trimmed || busy.value) return
        if (isDuplicate.value) {
            error.value = `Tag "${trimmed}" already exists`
            return
        }
        if (TAG_NAME_FORBIDDEN.test(trimmed)) {
            error.value = 'Tag name contains invalid characters'
            return
        }
        busy.value = true
        error.value = ''
        try {
            const text = annotated.value ? message.value.trim() : ''
            await useUiTransientStore().withBusy(() => window.api.createTag(trimmed, props.commit.hash, text || undefined), 'Creating tag…')
            await repoStore.refresh()
            notify(`Tag ${trimmed} created`, 'success')
            emit('close')
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busy.value = false
        }
    }
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="rebase-modal tag-modal">
            <div class="rebase-modal-header">
                <strong>Create tag</strong>
                <code class="rebase-base">{{ head }}</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger"
                    @click="emit('close')">
                    <i-lucide-x
                        width="16"
                        height="16" />
                </button>
            </div>
            <div class="tag-modal-body">
                <input
                    v-model="name"
                    autofocus
                    placeholder="Tag name"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <label class="tag-create-annotated">
                    <input
                        v-model="annotated"
                        type="checkbox" />
                    Annotated
                </label>
                <input
                    v-if="annotated"
                    v-model="message"
                    placeholder="Tag message"
                    @keydown.enter="submit()" />
                <div
                    v-if="isDuplicate"
                    class="tag-modal-error">
                    Tag name already exists
                </div>
                <div
                    v-else-if="error"
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
                        :disabled="!name.trim() || busy"
                        @click="submit()">
                        <i-lucide-check
                            width="13"
                            height="13" />
                        Create
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
