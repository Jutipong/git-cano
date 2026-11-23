<script setup lang="ts">
    import { useTemplateRef } from 'vue'
    import ICatppuccinFolderGit from '~icons/catppuccin/folder-git'
    import ICatppuccinFolderOpen from '~icons/catppuccin/folder-open'
    import ILucideFolderPlus from '~icons/lucide/folder-plus'

    import { useUiStore } from '../stores/ui'
    import { useModalA11y } from '../utils/modalA11y'
    import { formatCombo } from '../utils/shortcuts'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'open-local'): void
        (e: 'clone'): void
    }>()

    const ui = useUiStore()
    const dialog = useTemplateRef<HTMLElement>('dialog')
    const firstChoice = useTemplateRef<HTMLButtonElement>('firstChoice')

    useModalA11y({
        active: () => true,
        container: dialog,
        initialFocus: firstChoice,
        onClose: () => emit('close'),
    })
</script>

<template>
    <div class="confirm-dialog-overlay">
        <div
            ref="dialog"
            class="confirm-dialog open-repo-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-repo-title"
            tabindex="-1">
            <div class="confirm-dialog-header flow">
                <i-lucide-folder-plus
                    width="17"
                    height="17"
                    aria-hidden="true" />
                <strong id="open-repo-title">Open repository</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    title="Close"
                    aria-label="Close"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="confirm-dialog-body open-repo-body">
                <button
                    ref="firstChoice"
                    class="open-repo-item"
                    title="Pick a folder from your local disk"
                    @click="emit('open-local')">
                    <span class="open-repo-icon">
                        <i-catppuccin-folder-open
                            width="16"
                            height="16" />
                    </span>
                    <span class="open-repo-text">
                        <span class="open-repo-title">Open from local</span>
                        <span class="open-repo-desc">Pick a folder from your disk</span>
                    </span>
                    <kbd class="open-repo-kbd">{{ formatCombo(ui.getShortcut('openRepo')) }}</kbd>
                </button>
                <button
                    class="open-repo-item"
                    title="Clone a remote repository into a new folder"
                    @click="emit('clone')">
                    <span class="open-repo-icon">
                        <i-catppuccin-folder-git
                            width="16"
                            height="16" />
                    </span>
                    <span class="open-repo-text">
                        <span class="open-repo-title">Clone from URL</span>
                        <span class="open-repo-desc">Download a remote repository</span>
                    </span>
                    <kbd class="open-repo-kbd">{{ formatCombo(ui.getShortcut('cloneRepo')) }}</kbd>
                </button>
            </div>
            <div class="confirm-dialog-actions">
                <button
                    class="btn"
                    @click="emit('close')">
                    Cancel
                </button>
            </div>
        </div>
    </div>
</template>
