<script setup lang="ts">
    // Segmented "blocks" loader, ported from opencode CLI's Knight Rider spinner:
    // https://github.com/anomalyco/opencode (packages/tui/src/ui/spinner.ts, MIT).
    // A window of bright segments sweeps left↔right across a dim track and
    // dissolves back into the track while the head rests at an edge
    // (asymmetric timing: longer rest at the left edge).
    import { computed, onMounted, onUnmounted, ref } from 'vue'

    const SEGMENTS = 16
    const TRAIL_STEPS = 6
    const HOLD_START = 30
    const HOLD_END = 9
    const TICK_MS = 40

    // Alpha falloff from deriveTrailColors: head 1.0, bloom 0.9, then 0.65^(i-1)
    const TRAIL_ALPHA = Array.from({ length: TRAIL_STEPS }, (_, i) => (i === 0 ? 1 : i === 1 ? 0.9 : 0.65 ** (i - 1)))

    const frame = ref(0)
    const totalFrames = SEGMENTS + HOLD_END + (SEGMENTS - 1) + HOLD_START
    let timer: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
        timer = setInterval(() => {
            frame.value = (frame.value + 1) % totalFrames
        }, TICK_MS)
    })

    onUnmounted(() => {
        if (timer) clearInterval(timer)
    })

    const cells = computed(() => {
        const fi = frame.value
        const forwardFrames = SEGMENTS
        const backwardFrames = SEGMENTS - 1
        let activePos: number
        let isForward: boolean
        let holding = false
        let holdFrame = 0

        if (fi < forwardFrames) {
            activePos = fi
            isForward = true
        } else if (fi < forwardFrames + HOLD_END) {
            activePos = SEGMENTS - 1
            isForward = true
            holding = true
            holdFrame = fi - forwardFrames
        } else if (fi < forwardFrames + HOLD_END + backwardFrames) {
            activePos = SEGMENTS - 2 - (fi - forwardFrames - HOLD_END)
            isForward = false
        } else {
            activePos = 0
            isForward = false
            holding = true
            holdFrame = fi - forwardFrames - HOLD_END - backwardFrames
        }

        return Array.from({ length: SEGMENTS }, (_, i) => {
            // Directional distance: positive = trailing behind the head
            const dist = isForward ? activePos - i : i - activePos
            // While holding, the color index keeps shifting so the window dissolves
            const index = holding ? dist + holdFrame : dist >= 0 && dist < TRAIL_STEPS ? dist : -1
            return index >= 0 && index < TRAIL_STEPS ? { active: true, opacity: TRAIL_ALPHA[index] } : { active: false, opacity: 1 }
        })
    })
</script>

<template>
    <div
        class="kitt-scanner"
        aria-hidden="true">
        <span
            v-for="(cell, i) in cells"
            :key="i"
            class="kitt-seg"
            :class="{ active: cell.active }"
            :style="cell.active ? { opacity: cell.opacity } : undefined" />
    </div>
</template>

<style scoped>
    .kitt-scanner {
        display: flex;
        gap: 2px;
        width: 180px;
        height: 8px;
    }

    .kitt-seg {
        flex: 1;
        border-radius: 2px;
        background: var(--surface-2);
    }

    .kitt-seg.active {
        background: var(--teal);
    }
</style>
