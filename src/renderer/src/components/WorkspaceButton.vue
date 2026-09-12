<script setup lang="ts">
    import { nextTick, onMounted, onUnmounted, computed, inject, ref } from 'vue'
    import ILucideAlertTriangle from '~icons/lucide/alert-triangle'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucidePencil from '~icons/lucide/pencil'
    import ILucidePlus from '~icons/lucide/plus'
    import ILucideTrash2 from '~icons/lucide/trash2'
    import ILucideX from '~icons/lucide/x'

    import { useRepoStore } from '../stores/repo'
    import { useWorkspaceStore } from '../stores/workspace'
    import { confirmDialog } from '../utils/confirm'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'

    const repoStore = useRepoStore()
    const ws = useWorkspaceStore()

    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const open = ref(false)
    const adding = ref(false)
    const switching = ref(false)
    const newName = ref('')
    const nameInput = ref<HTMLInputElement | null>(null)
    const renaming = ref('')
    const renameValue = ref('')
    const renameInput = ref<HTMLInputElement | null>(null)
    const draggingName = ref<string | null>(null)

    const isDuplicate = computed(() => {
        const trimmed = newName.value.trim()
        return trimmed.length > 0 && ws.names.some(name => name.toLowerCase() === trimmed.toLowerCase())
    })

    const isRenameDuplicate = computed(() => {
        const trimmed = renameValue.value.trim()
        return trimmed.length > 0 && ws.names.some(name => name !== renaming.value && name.toLowerCase() === trimmed.toLowerCase())
    })

    function resetAdd() {
        adding.value = false
        newName.value = ''
    }

    function cancelRename() {
        renaming.value = ''
        renameValue.value = ''
    }

    function toggle() {
        open.value = !open.value
        if (!open.value) {
            resetAdd()
            cancelRename()
            draggingName.value = null
        }
    }

    function startAdd() {
        cancelRename()
        adding.value = true
        nextTick(() => nameInput.value?.focus())
    }

    function startRename(name: string) {
        resetAdd()
        renaming.value = name
        renameValue.value = name
        nextTick(() => {
            renameInput.value?.focus()
            renameInput.value?.select()
        })
    }

    function confirmRename() {
        if (!renaming.value || !renameValue.value.trim() || isRenameDuplicate.value) return
        const stored = ws.rename(renaming.value, renameValue.value)
        if (!stored) {
            notify(`Workspace "${renameValue.value.trim()}" already exists`, 'error')
            return
        }
        cancelRename()
    }

    async function confirmAdd() {
        const name = newName.value.trim()
        if (!name || isDuplicate.value) return
        const stored = ws.add(name)
        if (!stored) {
            notify(`Workspace "${name}" already exists`, 'error')
            return
        }
        resetAdd()
        await switchTo(stored)
    }

    async function deleteWorkspace(name: string) {
        const ok = await confirmDialog({
            message: `Delete workspace: ${name}`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        const wasActive = name === ws.active
        if (wasActive) {
            const fallback = ws.names.find(candidate => candidate !== name)
            if (fallback) {
                try {
                    // switchWorkspace has its own busy guard and needs busy clear internally,
                    // so it must NOT be wrapped in withBusy (which would no-op the switch).
                    await repoStore.switchWorkspace(fallback)
                } catch (error) {
                    notify(String(error).replace(/^Error:\s*/, ''), 'error')
                    return
                }
            }
        }
        if (!ws.remove(name)) return
        notify(`Workspace ${name} deleted`, 'success')
    }

    async function switchTo(name: string) {
        open.value = false
        resetAdd()
        cancelRename()
        if (name === ws.active) return
        switching.value = true
        try {
            // switchWorkspace has its own busy guard and needs busy clear internally,
            // so it must NOT be wrapped in withBusy (which would no-op the switch).
            await repoStore.switchWorkspace(name)
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            switching.value = false
        }
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!open.value) return
        if ((event.target as HTMLElement | null)?.closest('.workspace-wrap')) return
        open.value = false
        resetAdd()
        cancelRename()
        draggingName.value = null
    }

    function onDragStart(name: string, e: DragEvent) {
        if (renaming.value || switching.value) {
            e.preventDefault()
            return
        }
        draggingName.value = name
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', name)
        }
    }

    function onDragOver(index: number, e: DragEvent) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const fromName = draggingName.value
        if (!fromName || renaming.value) return
        const from = ws.names.indexOf(fromName)
        if (from < 0) return
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const side = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        const insertion = side === 'before' ? index : index + 1
        const to = insertion - (from < insertion ? 1 : 0)
        if (to !== from && to >= 0 && to < ws.names.length) ws.reorder(from, to)
    }

    function onDrop(e: DragEvent) {
        e.preventDefault()
        draggingName.value = null
    }

    function onDragEnd() {
        draggingName.value = null
    }

    onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
    onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
    <div class="workspace-wrap">
        <button
            class="workspace-btn"
            title="Work spaces"
            :disabled="switching"
            @click="toggle">
            <ThinkSpinner
                v-if="switching"
                compact />
            <span class="workspace-btn-name">{{ ws.active }}</span>
            <i-lucide-chevron-down
                width="12"
                height="12" />
        </button>
        <div
            v-if="open"
            class="workspace-pop">
            <div
                v-for="(name, index) in ws.names"
                :key="name"
                class="workspace-row"
                :class="{ renaming: renaming === name, dragging: draggingName === name }"
                :draggable="!renaming && !switching"
                @dragstart="onDragStart(name, $event)"
                @dragover="onDragOver(index, $event)"
                @drop="onDrop($event)"
                @dragend="onDragEnd">
                <template v-if="renaming === name">
                    <input
                        ref="renameInput"
                        v-model="renameValue"
                        class="workspace-add-input"
                        :class="{ invalid: isRenameDuplicate }"
                        type="text"
                        placeholder="Workspace name"
                        @keydown.enter.prevent="confirmRename()"
                        @keydown.esc.stop="cancelRename()" />
                    <button
                        class="icon-btn workspace-item-rename"
                        title="Cancel rename"
                        @click="cancelRename()">
                        <i-lucide-x
                            width="12"
                            height="12" />
                    </button>
                    <button
                        class="icon-btn workspace-item-rename"
                        title="Confirm rename"
                        :disabled="!renameValue.trim() || isRenameDuplicate"
                        @click="confirmRename()">
                        <i-lucide-check
                            width="12"
                            height="12" />
                    </button>
                </template>
                <template v-else>
                    <button
                        class="workspace-item"
                        :class="{ active: name === ws.active }"
                        :title="name"
                        @click="switchTo(name)">
                        <i-lucide-check
                            v-if="name === ws.active"
                            width="13"
                            height="13" />
                        <span
                            v-else
                            class="workspace-item-spacer" />
                        <span class="workspace-item-name">{{ name }}</span>
                    </button>
                    <button
                        v-if="ws.names.length > 1 && name !== ws.active"
                        class="icon-btn workspace-item-rename"
                        title="Rename workspace"
                        @click="startRename(name)">
                        <i-lucide-pencil
                            width="12"
                            height="12" />
                    </button>
                    <button
                        v-if="ws.names.length > 1 && name !== ws.active"
                        class="icon-btn danger workspace-item-delete"
                        title="Delete workspace"
                        @click="deleteWorkspace(name)">
                        <i-lucide-trash2
                            width="12"
                            height="12" />
                    </button>
                </template>
            </div>
            <div
                v-if="renaming && isRenameDuplicate"
                class="workspace-add-error">
                <i-lucide-alert-triangle
                    width="12"
                    height="12" />
                Workspace name already exists
            </div>
            <div class="workspace-sep" />
            <div
                v-if="adding"
                class="workspace-add-form">
                <input
                    ref="nameInput"
                    v-model="newName"
                    class="workspace-add-input"
                    :class="{ invalid: isDuplicate }"
                    type="text"
                    placeholder="Workspace name"
                    @keydown.enter.prevent="confirmAdd()"
                    @keydown.esc.stop="resetAdd()" />
                <div
                    v-if="isDuplicate"
                    class="workspace-add-error">
                    <i-lucide-alert-triangle
                        width="12"
                        height="12" />
                    Workspace name already exists
                </div>
                <div class="workspace-add-actions">
                    <button
                        class="btn small"
                        @click="resetAdd()">
                        Cancel
                    </button>
                    <button
                        class="btn primary small"
                        :disabled="!newName.trim() || isDuplicate"
                        @click="confirmAdd()">
                        <i-lucide-plus
                            width="13"
                            height="13" />
                        Add
                    </button>
                </div>
            </div>
            <button
                v-else
                class="workspace-item workspace-add"
                @click="startAdd()">
                <i-lucide-plus
                    width="13"
                    height="13" />
                <span class="workspace-item-name">Add workspace</span>
            </button>
        </div>
    </div>
</template>
