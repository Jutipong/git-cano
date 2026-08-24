<script setup lang="ts">
    import type { RepoStatus } from '@shared/types'

    const props = defineProps<{
        repo: RepoStatus
        refresh: () => Promise<unknown>
    }>()
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
        <div class="spacer" />
    </header>
</template>
