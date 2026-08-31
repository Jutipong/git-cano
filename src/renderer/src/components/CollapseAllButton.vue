<script setup lang="ts">
    defineProps<{
        allCollapsed: boolean
    }>()
    defineEmits<{
        (e: 'toggle'): void
    }>()
</script>

<template>
    <button
        class="collapse-all-btn"
        :class="{ 'all-collapsed': allCollapsed }"
        :title="allCollapsed ? 'Expand all folders' : 'Collapse all folders'"
        :aria-label="allCollapsed ? 'Expand all folders' : 'Collapse all folders'"
        @click="$emit('toggle')">
        <i-clarity-collapse-line
            width="13"
            height="13" />
    </button>
</template>
