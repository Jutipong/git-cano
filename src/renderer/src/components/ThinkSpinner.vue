<script setup lang="ts">
    // Opencode-style "thinking" spinner, ported from
    // https://github.com/anomalyco/opencode (packages/tui/src/component/spinner.tsx, MIT).
    // Braille-dots spinner with a label cycling through verbs every 3 seconds.
    import { computed, onMounted, onUnmounted, ref } from 'vue'

    const props = defineProps<{
        /** Whole label to display instead of the cycling verbs, e.g. the busy message. */
        suffix?: string
        /** Frames-only mode for inline use (buttons, small indicators). Inherits size/color. */
        compact?: boolean
    }>()

    const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    const SPINNER_INTERVAL_MS = 80
    const VERB_INTERVAL_MS = 3000
    const DEFAULT_SPINNER_VERBS = ['Thinking', 'Working', 'Processing', 'Analyzing', 'Computing']

    const frame = ref(0)
    const verbIndex = ref(0)
    let spinnerTimer: ReturnType<typeof setInterval> | null = null
    let verbTimer: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
        spinnerTimer = setInterval(() => {
            frame.value = (frame.value + 1) % SPINNER_FRAMES.length
        }, SPINNER_INTERVAL_MS)
        if (!props.compact && !props.suffix)
            verbTimer = setInterval(() => {
                verbIndex.value = (verbIndex.value + 1) % DEFAULT_SPINNER_VERBS.length
            }, VERB_INTERVAL_MS)
    })

    onUnmounted(() => {
        if (spinnerTimer) clearInterval(spinnerTimer)
        if (verbTimer) clearInterval(verbTimer)
    })

    function verbLabel(verb: string) {
        return /[.!?…]$/.test(verb) ? verb : `${verb}...`
    }

    const label = computed(() => {
        if (props.suffix) return props.suffix
        return verbLabel(DEFAULT_SPINNER_VERBS[verbIndex.value])
    })
</script>

<template>
    <span
        class="think-spinner"
        :class="{ compact }"
        role="status">
        <span class="think-spinner-frames">{{ SPINNER_FRAMES[frame] }}</span>
        <span
            v-if="!compact"
            class="think-spinner-label"
            >{{ label }}</span
        >
    </span>
</template>

<style scoped>
    .think-spinner {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--text-secondary);
        font-size: 13px;
        line-height: 1;
    }

    .think-spinner-frames {
        color: var(--teal);
        font-family: var(--font-mono, monospace);
        font-size: 14px;
        min-width: 12px;
        text-align: center;
    }

    .think-spinner.compact {
        gap: 0;
        color: inherit;
        font-size: inherit;
    }

    .think-spinner.compact .think-spinner-frames {
        color: currentColor;
        font-size: inherit;
        min-width: 1ch;
    }
</style>
