<script setup lang="ts">
    import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideTag from '~icons/lucide/tag'

    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUiTransientStore, type ToastKind } from '../stores/uiTransient'
    import AppCheckbox from './AppCheckbox.vue'

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
    const nameInput = useTemplateRef<HTMLInputElement>('nameInput')

    onMounted(async () => {
        document.addEventListener('keydown', onKey)
        nextTick(() => nameInput.value?.focus())
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
        return props.commit.shortHash?.trim() || props.commit.hash?.slice(0, 7) || ''
    })

    /** Full hover text — the header itself only shows the branch name or short hash. */
    const headTitle = computed(() => props.commit.subject?.trim() || props.commit.hash || '')

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
    <div class="confirm-dialog-overlay">
        <div class="confirm-dialog tag-confirm">
            <div class="confirm-dialog-header flow">
                <i-lucide-tag
                    width="17"
                    height="17" />
                <strong>Create tag</strong>
                <code
                    class="rebase-base prompt-chip"
                    :title="headTitle"
                    >{{ head }}</code
                >
            </div>
            <div class="confirm-dialog-body">
                <input
                    ref="nameInput"
                    v-model="name"
                    class="prompt-input"
                    autofocus
                    placeholder="Tag name"
                    spellcheck="false"
                    @input="error = ''"
                    @keydown.enter="submit()" />
                <AppCheckbox
                    v-model="ui.tagPushToOrigin"
                    class="prompt-option">
                    Push to origin
                </AppCheckbox>
                <div
                    v-if="isDuplicate"
                    class="prompt-error">
                    Tag name already exists
                </div>
                <div
                    v-else-if="error"
                    class="prompt-error">
                    {{ error }}
                </div>
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    :disabled="busy"
                    @click="emit('close')">
                    Cancel
                </button>
                <button
                    class="btn primary"
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
</template>
