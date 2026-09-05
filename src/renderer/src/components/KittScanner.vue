<script setup lang="ts">
    // Text "moving scanner" loader, e.g. [░░░░░████░░░░░░░░].
    // A blue block glides left↔right with a fading comet trail
    // streaming behind it (trail follows the direction of travel).
    import { computed, onMounted, onUnmounted, ref } from 'vue'

    const TRACK_LEN = 16
    const BLOCK = 4
    const TICK_MS = 70

    const frame = ref(0)
    const maxPos = TRACK_LEN - BLOCK
    const totalFrames = maxPos * 2
    let timer: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
        timer = setInterval(() => {
            frame.value = (frame.value + 1) % totalFrames
        }, TICK_MS)
    })

    onUnmounted(() => {
        if (timer) clearInterval(timer)
    })

    interface Cell {
        char: string
        cls: string
    }

    const cells = computed<Cell[]>(() => {
        const cycle = frame.value % totalFrames
        const forward = cycle <= maxPos
        const pos = forward ? cycle : totalFrames - cycle
        return Array.from({ length: TRACK_LEN }, (_, i) => {
            if (i >= pos && i < pos + BLOCK) return { char: '█', cls: 'bright' }
            // Trail streams behind the head: left side when moving right,
            // right side when moving left.
            if (forward) {
                if (i === pos - 1) return { char: '▓', cls: 'trail' }
                if (i === pos - 2) return { char: '▒', cls: 'faint' }
            } else {
                if (i === pos + BLOCK) return { char: '▓', cls: 'trail' }
                if (i === pos + BLOCK + 1) return { char: '▒', cls: 'faint' }
            }
            return { char: '░', cls: 'dim' }
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
            class="kitt-cell"
            :class="`kitt-${cell.cls}`"
            >{{ cell.char }}</span
        >
    </div>
</template>

<style scoped>
    .kitt-scanner {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono, monospace);
        font-size: 15px;
        line-height: 1;
        white-space: pre;
        user-select: none;
        animation: kitt-in 0.3s ease;
    }

    @keyframes kitt-in {
        from {
            opacity: 0;
        }
    }

    .kitt-cell {
        display: inline-block;
        width: 1ch;
        text-align: center;
    }

    .kitt-dim {
        color: var(--text-muted);
        opacity: 0.35;
    }

    .kitt-faint {
        color: var(--teal);
        opacity: 0.4;
    }

    .kitt-trail {
        color: var(--teal);
        opacity: 0.7;
    }

    .kitt-bright {
        color: var(--teal);
        text-shadow: 0 0 6px color-mix(in srgb, var(--teal) 45%, transparent);
    }
</style>
