<script setup lang="ts">
    import IAndrsrxnTerminalSquare from '~icons/andrsrxn/terminal-square'

    /** Terminal icon with a live-shell total badge on its corner (panel header and graph toolbar). */
    defineProps<{ count: number; title?: string }>()
</script>

<template>
    <span
        class="terminal-count-icon"
        :title="title">
        <i-andrsrxn-terminal-square
            width="14"
            height="14" />
        <span
            v-if="count"
            class="terminal-count-badge"
            aria-hidden="true">{{ count }}</span>
    </span>
</template>
