<script setup lang="ts">
    import { SHORTCUTS, isMac } from '../utils/shortcuts'
    import CloseXIcon from './CloseXIcon.vue'

    const emit = defineEmits<{ (e: 'close'): void }>()

    onMounted(() => document.addEventListener('keydown', onKey))
    onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

    function onKey(event: KeyboardEvent) {
        if (event.key === 'Escape') emit('close')
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal shortcuts-modal">
            <div class="rebase-modal-header">
                <strong>Keyboard shortcuts</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </div>
            <div class="shortcuts-modal-body">
                <div class="shortcuts-table">
                    <span class="shortcuts-head" />
                    <span class="shortcuts-head">macOS</span>
                    <span class="shortcuts-head">Windows</span>
                    <template
                        v-for="shortcut in SHORTCUTS"
                        :key="shortcut.id">
                        <span class="shortcuts-label">{{ shortcut.label }}</span>
                        <span class="shortcuts-keys">
                            <kbd
                                v-for="key in shortcut.mac"
                                :key="key"
                                >{{ key }}</kbd
                            >
                        </span>
                        <span class="shortcuts-keys">
                            <kbd
                                v-for="key in shortcut.win"
                                :key="key"
                                >{{ key }}</kbd
                            >
                        </span>
                    </template>
                </div>
                <p
                    v-if="isMac"
                    class="shortcuts-note">
                    ⌘ works system-wide alongside Ctrl on macOS.
                </p>
            </div>
        </div>
    </div>
</template>
