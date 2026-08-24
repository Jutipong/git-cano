<script setup lang="ts">
    import { X } from 'lucide-vue-next'
    import { computed, onMounted, ref } from 'vue'

    interface BlameLine {
        hash: string
        author: string
        date: string
        lineNumber: number
        content: string
    }

    const props = defineProps<{ file: string }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    const lines = ref<BlameLine[]>([])
    const loading = ref(true)

    onMounted(async () => {
        try {
            lines.value = await window.api.blame(props.file)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        } finally {
            loading.value = false
        }
    })

    // alternate background per commit block for readability
    const shadeOf = computed(() => {
        const map = new Map<string, number>()
        let blockIndex = -1
        for (const line of lines.value) {
            if (!map.has(line.hash)) map.set(line.hash, ++blockIndex % 2)
        }
        return map
    })

    function formatDate(value: string): string {
        const date = new Date(value)
        return Number.isNaN(date.getTime())
            ? value
            : date.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
    }
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="rebase-modal blame-modal">
            <div class="rebase-modal-header">
                <strong>Blame</strong>
                <code class="rebase-base">{{ file }}</code>
                <span class="spacer" />
                <span
                    v-if="loading"
                    class="muted"
                    >loading…</span
                >
                <button
                    class="icon-btn"
                    @click="emit('close')">
                    <X :size="16" />
                </button>
            </div>
            <div class="blame-body">
                <div
                    v-for="line in lines"
                    :key="line.lineNumber"
                    class="blame-line"
                    :class="`shade-${shadeOf.get(line.hash) ?? 0}`">
                    <code class="blame-hash">{{ line.hash.slice(0, 7) }}</code>
                    <span class="blame-author">{{ line.author }}</span>
                    <span class="blame-date">{{ formatDate(line.date) }}</span>
                    <span class="blame-ln">{{ line.lineNumber }}</span>
                    <pre>{{ line.content }}</pre>
                </div>
                <div
                    v-if="!loading && lines.length === 0"
                    class="sidebar-empty">
                    Nothing to blame
                </div>
            </div>
        </div>
    </div>
</template>
