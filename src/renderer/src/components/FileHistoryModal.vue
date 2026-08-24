<script setup lang="ts">
    interface Props {
        file: string
    }
    const props = defineProps<Props>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string) => void>('notify', () => {})

    interface HistoryCommit {
        hash: string
        shortHash: string
        author: string
        subject: string
    }

    const history = ref<HistoryCommit[]>([])
    const selectedHash = ref<string | null>(null)
    const diffLines = ref<{ type: string; text: string }[]>([])

    onMounted(async () => {
        try {
            history.value = await window.api.fileHistory(props.file)
            if (history.value[0]) select(history.value[0].hash)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    })

    async function select(hash: string) {
        selectedHash.value = hash
        try {
            diffLines.value = await window.api.commitFileDiff(hash, props.file)
        } catch {
            diffLines.value = []
        }
    }
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="rebase-modal history-modal">
            <div class="rebase-modal-header">
                <strong>History of</strong>
                <code class="rebase-base">{{ file }}</code>
                <span class="spacer" />
                <button
                    class="icon-btn danger"
                    @click="emit('close')">
                    <i-lucide-x
                        width="16"
                        height="16" />
                </button>
            </div>
            <div class="history-body">
                <div class="history-list">
                    <div
                        v-for="commit in history"
                        :key="commit.hash"
                        class="history-row"
                        :class="{ selected: selectedHash === commit.hash }"
                        @click="select(commit.hash)">
                        <code>{{ commit.shortHash }}</code>
                        <span class="subject-text">{{ commit.subject }}</span>
                        <span class="commit-author">{{ commit.author }}</span>
                    </div>
                    <div
                        v-if="history.length === 0"
                        class="sidebar-empty">
                        No commits touch this file
                    </div>
                </div>
                <div class="history-diff">
                    <pre
                        v-for="(line, index) in diffLines"
                        :key="index"
                        :class="{ 'hd-add': line.type === 'add', 'hd-del': line.type === 'del', 'hd-hunk': line.type === 'hunk' }"
                        >{{ line.text }}</pre>
                    <div
                        v-if="diffLines.length === 0"
                        class="sidebar-empty">
                        Select a commit
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
