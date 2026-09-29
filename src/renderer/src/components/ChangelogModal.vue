<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted } from 'vue'

    import { useUpdaterStore } from '../stores/updater'
    import { stripMarkdown } from '../utils/changelog'
    import CloseXIcon from './CloseXIcon.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()

    const updater = useUpdaterStore()

    onMounted(() => {
        document.addEventListener('keydown', onKey)
        // currentVersion may be empty when no update check has run yet this session.
        void window.api
            .getVersion()
            .then(current => {
                if (current) updater.currentVersion = current
            })
            .catch(() => {})
            .finally(() => updater.loadChangelog())
    })

    const version = computed(() => updater.notes?.version || updater.currentVersion)
    const text = computed(() => (updater.notes ? stripMarkdown(updater.notes.body) : ''))
    const releasePageUrl = computed(() => updater.notes?.htmlUrl || updater.releaseUrl)

    function openReleasePage() {
        if (releasePageUrl.value) void window.api.openReleasePage(releasePageUrl.value)
    }

    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            event.stopPropagation()
            emit('close')
        }
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal changelog-modal">
            <div class="rebase-modal-header">
                <strong>What's new</strong>
                <span
                    v-if="version"
                    class="chip">{{ version }}</span>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="changelog-body">
                <div
                    v-if="updater.notesLoading"
                    class="changelog-loading">
                    <ThinkSpinner suffix="Loading release notes…" />
                </div>
                <template v-else-if="updater.notes">
                    <p
                        v-if="text"
                        class="changelog-text">{{ text }}</p>
                    <p
                        v-else
                        class="changelog-empty">This release has no notes.</p>
                </template>
                <p
                    v-else
                    class="changelog-empty">Could not load release notes for this version.</p>
            </div>
            <div class="changelog-actions">
                <button
                    v-if="releasePageUrl"
                    class="btn"
                    @click="openReleasePage">
                    <i-lucide-external-link
                        width="13"
                        height="13" />
                    View on GitHub
                </button>
                <button
                    class="btn primary"
                    @click="emit('close')">Close</button>
            </div>
        </div>
    </div>
</template>
