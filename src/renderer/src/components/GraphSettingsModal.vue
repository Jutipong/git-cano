<script setup lang="ts">
    import { useUiStore, COMMIT_COLUMN_DEFAULTS, MANDATORY_COMMIT_COLUMNS, type CommitColumn } from '../stores/ui'
    import { formatDatePattern } from '../utils/format'

    const emit = defineEmits<{ (e: 'close'): void }>()

    const ui = useUiStore()

    const COLUMNS: { key: CommitColumn; label: string; hint: string }[] = [
        { key: 'graph', label: 'Graph', hint: 'Commit lane lines and nodes' },
        { key: 'message', label: 'Message', hint: 'Commit subject and ref chips' },
        { key: 'author', label: 'Author', hint: 'Author avatar and name' },
        { key: 'hash', label: 'Hash', hint: 'Short commit hash' },
        { key: 'date', label: 'Date', hint: 'Commit date' },
    ]

    const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy HH:mm'

    const visibleCount = computed(() => COLUMNS.filter(column => ui.commitColumns[column.key]).length)

    /** live preview of the date pattern against right now, so the user sees the result while typing */
    const datePreview = computed(() => {
        const pattern = ui.commitDateFormat.trim() || DEFAULT_DATE_FORMAT
        return formatDatePattern(new Date().toISOString(), pattern)
    })

    /** keep at least one column on screen so the history never goes blank */
    function isLastVisible(key: CommitColumn) {
        return ui.commitColumns[key] && visibleCount.value === 1
    }

    /** mandatory columns can never be unchecked (they're part of the history itself) */
    function isMandatory(key: CommitColumn) {
        return MANDATORY_COMMIT_COLUMNS.includes(key)
    }

    /** a column is locked when it's mandatory, or when it's the last one still visible */
    function isLocked(key: CommitColumn) {
        return isMandatory(key) || isLastVisible(key)
    }

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
                <p class="graph-settings-hint">Choose which fields to show in the commit history. Graph and Message are always shown. Applies to every repository.</p>
                <label
                    v-for="column in COLUMNS"
                    :key="column.key"
                    class="graph-settings-row"
                    :class="{ disabled: isLocked(column.key) }">
                    <input
                        v-model="ui.commitColumns[column.key]"
                        type="checkbox"
                        :disabled="isLocked(column.key)" />
                    <span class="graph-settings-label">
                        <strong>{{ column.label }}</strong>
                        <small>{{ column.hint }}</small>
                    </span>
                    <span
                        v-if="isMandatory(column.key)"
                        class="graph-settings-locked">
                        <i-lucide-lock
                            width="10"
                            height="10" />
                        Always on
                    </span>
                </label>
                <div
                    v-if="ui.commitColumns.date"
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
