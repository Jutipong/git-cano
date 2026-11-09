<script setup lang="ts">
    import ILucideGitBranch from '~icons/lucide/git-branch'

    defineProps<{
        branch: string
        /** Repo tab session color — icon and name take it; the CSS falls back to `--green`. */
        color?: string | null
        /** Graph-header copy: same type and colors, shorter pill. */
        compact?: boolean
    }>()
</script>

<template>
    <span
        class="branch-chip"
        :class="{ compact }"
        :title="`Current branch: ${branch}`"
        :style="color ? { '--branch-color': color } : undefined">
        <i-lucide-git-branch
            width="13"
            height="13" />
        <span class="branch-chip-name">{{ branch }}</span>
    </span>
</template>
