<script setup lang="ts">
    import { useUiStore, COMMIT_COLUMN_DEFAULTS, type CommitColumn } from '../stores/ui'
    import { formatDatePattern } from '../utils/format'

    const emit = defineEmits<{ (e: 'close'): void }>()

    const ui = useUiStore()

    /** columns that are always shown and can't be toggled (they are the history itself) */
    const STATIC_COLUMNS: { key: string; label: string; hint: string }[] = [
        { key: 'graph', label: 'Graph', hint: 'Commit lane lines and nodes' },
        { key: 'message', label: 'Message', hint: 'Commit subject and ref chips' },
    ]

    const COLUMNS: { key: CommitColumn; label: string; hint: string }[] = [
        { key: 'author', label: 'Author', hint: 'Author avatar and name' },
        { key: 'hash', label: 'Hash', hint: 'Short commit hash' },
        { key: 'date', label: 'Date', hint: 'Commit date' },
    ]

    const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy HH:mm'

    /** live preview of the date pattern against right now, so the user sees the result while typing */
    const datePreview = computed(() => {
        const pattern = ui.commitDateFormat.trim() || DEFAULT_DATE_FORMAT
        return formatDatePattern(new Date().toISOString(), pattern)
    })

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }
    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        class="modal-overlay"
        @mousedown.self="emit('close')">
        <div class="graph-settings-modal">
            <div class="rebase-modal-header">
                <strong>Commit history settings</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    @click="emit('close')">
                    <i-lucide-x
                        width="16"
                        height="16" />
                </button>
            </div>
            <div class="graph-settings-body">
                <p class="graph-settings-hint">Graph and Message are always shown. Choose which other fields to display in the commit history. Applies to every repository.</p>
                <div
                    v-for="column in STATIC_COLUMNS"
                    :key="column.key"
                    class="graph-settings-row readonly">
                    <span
                        class="graph-settings-check"
                        aria-hidden="true">
                        <i-lucide-check
                            width="11"
                            height="11"
                            :stroke-width="3" />
                    </span>
                    <span class="graph-settings-label">
                        <strong>{{ column.label }}</strong>
                        <small>{{ column.hint }}</small>
                    </span>
                    <span class="graph-settings-locked">
                        <i-lucide-lock
                            width="10"
                            height="10" />
                        Always on
                    </span>
                </div>
                <label
                    v-for="column in COLUMNS"
                    :key="column.key"
                    class="graph-settings-row">
                    <input
                        v-model="ui.commitColumns[column.key]"
                        type="checkbox" />
                    <span class="graph-settings-label">
                        <strong>{{ column.label }}</strong>
                        <small>{{ column.hint }}</small>
                    </span>
                </label>
                <div
                    class="graph-settings-format">
                    <label class="graph-settings-format-label">Date format</label>
                    <input
                        v-model="ui.commitDateFormat"
                        class="graph-settings-format-input"
                        :placeholder="DEFAULT_DATE_FORMAT"
                        spellcheck="false" />
                    <div class="graph-settings-format-meta">
                        <code>yyyy</code><code>yy</code><code>MM</code><code>dd</code><code>HH</code><code>hh</code><code>mm</code><code>ss</code><code>a</code>
                    </div>
                    <small class="graph-settings-format-preview">{{ datePreview }}</small>
                </div>
            </div>
            <div class="graph-settings-actions">
                <button
                    class="btn small"
                    title="Restore default columns and date format"
                    @click="ui.resetCommitColumns()">
                    <i-lucide-rotate-ccw
                        width="13"
                        height="13" />
                    Reset to defaults
                </button>
                <span class="spacer" />
                <button
                    class="btn primary small"
                    @click="emit('close')">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    Done
                </button>
            </div>
        </div>
    </div>
</template>
