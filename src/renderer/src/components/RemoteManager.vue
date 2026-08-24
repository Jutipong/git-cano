<script setup lang="ts">
    import { Link2Off, Plus, X } from 'lucide-vue-next'
    import { onMounted, ref } from 'vue'

    const props = defineProps<{ refresh: () => Promise<unknown> }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    interface RemoteEntry {
        name: string
        url: string
    }

    const remotes = ref<RemoteEntry[]>([])
    const newName = ref('')
    const newUrl = ref('')
    const editingUrl = ref<Record<string, string>>({})

    async function load() {
        try {
            remotes.value = await window.api.remotesFull()
        } catch (error) {
            notify(String(error))
        }
    }
    onMounted(load)

    async function run(fn: () => Promise<unknown>, successMessage: string) {
        try {
            await fn()
            await load()
            await props.refresh()
            notify(successMessage)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function saveUrl(remote: RemoteEntry) {
        void run(() => window.api.setRemoteUrl(remote.name, editingUrl.value[remote.name]), `URL of ${remote.name} updated`)
    }
    function removeRemote(remote: RemoteEntry) {
        if (!window.confirm(`Remove remote "${remote.name}"?`)) return
        void run(() => window.api.removeRemote(remote.name), `Remote ${remote.name} removed`)
    }
    function fetchAll() {
        void run(() => window.api.fetch(), 'Fetched all remotes')
    }
    function pushTags() {
        void run(() => window.api.pushTags(), 'Tags pushed')
    }

    function addRemote() {
        if (!newName.value.trim() || !newUrl.value.trim()) return
        void run(() => window.api.addRemote(newName.value.trim(), newUrl.value.trim()), `Remote ${newName.value} added`)
        newName.value = ''
        newUrl.value = ''
    }
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="rebase-modal remote-modal">
            <div class="rebase-modal-header">
                <strong>Manage remotes</strong>
                <span class="spacer" />
                <button
                    class="icon-btn"
                    @click="emit('close')">
                    <X :size="16" />
                </button>
            </div>

            <div class="remote-list">
                <div
                    v-for="remote in remotes"
                    :key="remote.name"
                    class="remote-row">
                    <strong>{{ remote.name }}</strong>
                    <input
                        v-model="editingUrl[remote.name]"
                        class="remote-url"
                        :placeholder="remote.url"
                        @focus="editingUrl[remote.name] ??= remote.url" />
                    <button
                        v-if="(editingUrl[remote.name] ?? remote.url) !== remote.url"
                        class="detail-action"
                        @click="saveUrl(remote)">
                        Save URL
                    </button>
                    <button
                        class="icon-btn danger"
                        :title="`Remove ${remote.name}`"
                        @click="removeRemote(remote)">
                        <Link2Off :size="13" />
                    </button>
                </div>
                <div
                    v-if="remotes.length === 0"
                    class="sidebar-empty">
                    No remotes configured
                </div>
            </div>

            <form
                class="remote-add"
                @submit.prevent="addRemote()">
                <input
                    v-model="newName"
                    placeholder="name" />
                <input
                    v-model="newUrl"
                    placeholder="https://github.com/user/repo.git" />
                <button
                    type="submit"
                    class="btn primary small">
                    <Plus :size="13" /> Add remote
                </button>
            </form>

            <div class="rebase-modal-footer">
                <span class="rebase-hint">Editing a URL only changes where fetch/push points</span>
                <span class="spacer" />
                <button
                    class="btn small"
                    @click="fetchAll()">
                    Fetch all
                </button>
                <button
                    class="btn primary small"
                    @click="pushTags()">
                    Push tags
                </button>
            </div>
        </div>
    </div>
</template>
