<script setup lang="ts">
    import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideCheck from '~icons/lucide/check'

    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import AppCheckbox from './AppCheckbox.vue'
    import CloseXIcon from './CloseXIcon.vue'

    const props = defineProps<{
        commit: { hash: string | null; subject?: string | null; shortHash?: string | null; branchName?: string | null }
    }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const repoStore = useRepoStore()

    const name = ref('')
    const existing = ref<string[]>([])
    const busy = ref(false)
    const error = ref('')
    const ui = useUiStore()

    onMounted(async () => {
        document.addEventListener('keydown', onKey)
        try {
            const tags = await window.api.tags()
            existing.value = tags.map(tag => tag.name)
        } catch {}
    })
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }

    const head = computed(() => {
        const branch = props.commit.branchName?.trim() ?? ''
        if (branch) return branch.length > 48 ? `${branch.slice(0, 48).trimEnd()}…` : branch
        const short = props.commit.shortHash?.trim() || props.commit.hash?.slice(0, 7) || ''
        const s = props.commit.subject?.trim() ?? ''
        const truncated = s.length > 48 ? `${s.slice(0, 48).trimEnd()}…` : s
        if (short && truncated) return `${short} — ${truncated}`
        return short || truncated
    })

    const TAG_NAME_FORBIDDEN = /[\s~^:?*[\]\\]/

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
            await useUiTransientStore().withBusy(() => window.api.createTag(trimmed, props.commit.hash ?? null), 'Creating tag…')
            await repoStore.refresh()
            if (ui.tagPushToOrigin) {
                try {
                    await useUiTransientStore().withBusy(() => window.api.pushTag(trimmed), 'Pushing tag…')
                    notify(`Tag ${trimmed} created and pushed`, 'success')
                } catch (pushErr) {
                    notify(`Tag ${trimmed} created, but push failed: ${String(pushErr).replace(/^Error:\s*/, '')}`, 'error')
                }
            } else {
                notify(`Tag ${trimmed} created`, 'success')
            }
            emit('close')
        } catch (err) {
            error.value = String(err).replace(/^Error:\s*/, '')
        } finally {
            busy.value = false
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal tag-modal">
            <div class="rebase-modal-header">
                <strong>Create tag</strong>
                <code class="rebase-base">{{ head }}</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="tag-modal-body">
                <input
                    v-model="name"
                    autofocus
                    placeholder="Tag name"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <AppCheckbox
                    v-model="ui.tagPushToOrigin"
                    class="tag-create-annotated">
                    Push to origin
                </AppCheckbox>
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
