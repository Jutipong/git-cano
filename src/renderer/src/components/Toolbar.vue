<script setup lang="ts">
    import { useUiStore } from '../stores/ui'

    import type { RepoStatus } from '@shared/types'

    const props = defineProps<{
        repo: RepoStatus
        refresh: () => Promise<unknown>
        bisectActive: boolean
    }>()
    const search = defineModel<string>('search', { default: '' })
    const emit = defineEmits<{ (e: 'open-tools'): void }>()
    const ui = useUiStore()

    function actFetch() {
        void act('Fetch', () => window.api.fetch())
    }
    function actPull() {
        void act('Pull', () => window.api.pull())
    }
    function actPush() {
        void act('Push', () => window.api.push())
    }
    function actRefresh() {
        void act('Refresh', props.refresh)
    }

    const busy = ref<string | null>(null)

    async function act(label: string, fn: () => Promise<unknown>) {
        if (busy.value) return
        busy.value = label
        try {
            const result = await fn()
            await props.refresh()
            const message = typeof result === 'string' && result.trim() ? result.trim() : `${label} completed`
            ui.notify(message, 'success')
        } catch (error) {
            ui.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            busy.value = null
        }
    }
</script>

<template>
    <header class="toolbar">
        <div
            class="product-mark"
            aria-label="Open Git">
            <span class="product-mark-icon">G</span>
            <span>Open Git</span>
        </div>
        <div class="toolbar-divider" />
        <div class="repo-context">
            <i-lucide-folder-git2
                width="17"
                height="17" />
            <div class="repo-context-copy">
                <strong>{{ repo.name }}</strong>
                <span :title="repo.path">{{ repo.path }}</span>
            </div>
        </div>
        <div class="toolbar-divider" />
        <div
            class="branch-chip"
            title="Current branch">
            <i-lucide-git-branch
                width="15"
                height="15" />
            <span>{{ repo.branch }}</span>
            <span
                v-if="repo.tracking"
                class="ahead-behind">
                <span v-if="repo.ahead > 0">↑{{ repo.ahead }}</span>
                <span v-if="repo.behind > 0">↓{{ repo.behind }}</span>
            </span>
        </div>
        <div class="spacer" />
        <label
            class="commit-search"
            title="Search commits">
            <i-lucide-search
                width="15"
                height="15" />
            <input
                v-model="search"
                placeholder="Search commits" />
            <button
                v-if="search"
                type="button"
                class="search-clear"
                @click="search = ''">
                ×
            </button>
        </label>
        <button
            class="toolbar-icon-button"
            title="Refresh"
            :disabled="!!busy"
            @click="actRefresh()">
            <i-lucide-refresh-cw
                :class="{ spinning: busy === 'Refresh' }"
                width="16"
                height="16" />
        </button>
        <div class="toolbar-divider" />
        <div class="remote-actions">
            <button
                class="toolbar-action action-fetch"
                :disabled="!!busy"
                @click="actFetch()">
                <i-lucide-arrow-down-to-line
                    :class="{ 'bouncing-down': busy === 'Fetch' }"
                    width="15"
                    height="15" />
                <span>Fetch</span>
            </button>
            <button
                class="toolbar-action action-pull"
                :disabled="!!busy"
                @click="actPull()">
                <i-lucide-arrow-down
                    :class="{ 'bouncing-down': busy === 'Pull' }"
                    width="15"
                    height="15" />
                <span>Pull</span>
            </button>
            <button
                class="toolbar-action primary-action"
                :disabled="!!busy"
                @click="actPush()">
                <i-lucide-arrow-up
                    :class="{ 'bouncing-up': busy === 'Push' }"
                    width="15"
                    height="15" />
                <span>Push</span>
            </button>
        </div>
        <button
            class="toolbar-icon-button"
            :title="ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="ui.toggleTheme()">
            <i-lucide-sun
                v-if="ui.theme === 'dark'"
                width="16"
                height="16" />
            <i-lucide-moon
                v-else
                width="16"
                height="16" />
        </button>
        <button
            class="toolbar-icon-button"
            :class="{ 'bisect-active': bisectActive }"
            title="Advanced tools (bisect, worktrees, submodules)"
            @click="emit('open-tools')">
            <i-lucide-more-horizontal
                width="18"
                height="18" />
        </button>
    </header>
</template>
