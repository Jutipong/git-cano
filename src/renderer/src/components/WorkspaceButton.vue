<script setup lang="ts">
    import { nextTick } from 'vue'

    import { confirmDialog } from '../utils/confirm'
    import { useRepoStore } from '../stores/repo'
    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import { useWorkspaceStore } from '../stores/workspace'

    const repoStore = useRepoStore()
    const ws = useWorkspaceStore()

    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const open = ref(false)
    const adding = ref(false)
    const newName = ref('')
    const nameInput = ref<HTMLInputElement | null>(null)

    const isDuplicate = computed(() => {
        const trimmed = newName.value.trim()
        return trimmed.length > 0 && ws.names.some(name => name.toLowerCase() === trimmed.toLowerCase())
    })

    function resetAdd() {
        adding.value = false
        newName.value = ''
    }

    function toggle() {
        open.value = !open.value
        if (!open.value) resetAdd()
    }

    function startAdd() {
        adding.value = true
        nextTick(() => nameInput.value?.focus())
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
        if (name === ws.active) return
        try {
            // switchWorkspace has its own busy guard and needs busy clear internally,
            // so it must NOT be wrapped in withBusy (which would no-op the switch).
            await repoStore.switchWorkspace(name)
            notify(`Switched to workspace ${name}`, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''), 'error')
        }
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!open.value) return
        if ((event.target as HTMLElement | null)?.closest('.workspace-wrap')) return
        open.value = false
        resetAdd()
    }

    onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
    onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
    <div class="workspace-wrap">
        <button
            class="workspace-btn"
            title="Work spaces"
            @click="toggle">
            <i-lucide-layers
                width="13"
                height="13" />
            <span class="workspace-btn-name">{{ ws.active }}</span>
            <i-lucide-chevron-down
                width="12"
                height="12" />
        </button>
        <div
            v-if="open"
            class="workspace-pop">
            <div
                v-for="name in ws.names"
                :key="name"
                class="workspace-row">
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
                    class="icon-btn danger workspace-item-delete"
                    title="Delete workspace"
                    @click="deleteWorkspace(name)">
                    <i-lucide-trash2
                        width="12"
                        height="12" />
                </button>
            </div>
            <div class="workspace-sep" />
            <div
                v-if="adding"
                class="workspace-add-form">
                <input
                    ref="nameInput"
                    v-model="newName"
                    class="workspace-add-input"
                    type="text"
                    placeholder="Workspace name"
                    @keydown.enter.prevent="confirmAdd()"
                    @keydown.esc.stop="resetAdd()" />
                <div
                    v-if="isDuplicate"
                    class="workspace-add-error">
                    Workspace name already exists
                </div>
                <div class="workspace-add-actions">
                    <button
                        class="btn small"
                        @click="resetAdd()">
                        <i-lucide-x
                            width="13"
                            height="13" />
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
