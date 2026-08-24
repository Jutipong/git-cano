<script setup lang="ts">
    import type { RepoStatus } from '@shared/types'

    const emit = defineEmits<{
        (e: 'opened', status: RepoStatus): void
    }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    const recent = ref<string[]>([])
    const cloneUrl = ref('')

    onMounted(async () => {
        try {
            recent.value = await window.api.recentList()
        } catch {
            /* ignore */
        }
    })

    function openPick() {
        void open(() => window.api.pickAndOpen())
    }
    function openInit() {
        void open(() => window.api.init())
    }
    function openClone() {
        if (cloneUrl.value.trim()) void open(() => window.api.clone(cloneUrl.value.trim()))
    }
    function openRecent(entry: string) {
        void open(() => window.api.openPath(entry))
    }

    async function open(fn: () => Promise<RepoStatus | null>) {
        try {
            const status = await fn()
            if (status) emit('opened', status)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function removeRecent(entry: string) {
        await window.api.recentRemove(entry).catch(() => {})
        recent.value = recent.value.filter(item => item !== entry)
    }
</script>

<template>
    <div class="welcome">
        <h1>🔀 Open Git</h1>
        <p class="tagline">A lightweight Git GUI — basic features only</p>

        <div class="welcome-actions">
            <button
                class="btn primary"
                @click="openPick()">
                Open a Repository
            </button>
            <button
                class="btn"
                @click="openInit()">
                Init New Repository
            </button>
        </div>

        <form
            class="clone-box"
            @submit.prevent="openClone()">
            <input
                v-model="cloneUrl"
                placeholder="https://github.com/user/repo.git" />
            <button
                type="submit"
                class="btn"
                :disabled="!cloneUrl.trim()">
                Clone URL
            </button>
        </form>

        <div
            v-if="recent.length > 0"
            class="recent">
            <h3>Recent repositories</h3>
            <div
                v-for="entry in recent"
                :key="entry"
                class="recent-item"
                @click="openRecent(entry)">
                <span class="recent-label">📂 {{ entry }}</span>
                <button
                    class="icon-btn recent-remove"
                    :title="`Remove ${entry} from list`"
                    @click.stop="removeRecent(entry)">
                    <i-lucide-x
                        width="13"
                        height="13" />
                </button>
            </div>
        </div>
    </div>
</template>
