<script setup lang="ts">
    import IClarityCollapseLine from '~icons/clarity/collapse-line'
    import ISolarRoundDoubleAltArrowUpLineDuotone from '~icons/solar/round-double-alt-arrow-up-line-duotone'

    defineProps<{
        allCollapsed: boolean
        /** Sidebar toolbar variant: Solar's duotone circle replaces the bordered shell. */
        duotone?: boolean
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
        @click.stop="$emit('toggle')">
        <i-solar-round-double-alt-arrow-up-line-duotone
            v-if="duotone"
            width="22"
            height="22" />
        <i-clarity-collapse-line
            v-else
            width="13"
            height="13" />
    </button>
</template>
