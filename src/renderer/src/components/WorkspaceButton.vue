<script setup lang="ts">
    import { nextTick } from 'vue'

    import { useRepoStore } from '../stores/repo'
    import type { NotifyOptions, ToastKind } from '../stores/uiTransient'
    import { useWorkspaceStore } from '../stores/workspace'

    const repoStore = useRepoStore()
    const ws = useWorkspaceStore()
    const uiTransient = useUiTransientStore()

    const notify = inject<(m: string, t?: ToastKind, o?: NotifyOptions) => void>('notify', () => {})

    const open = ref(false)
    const adding = ref(false)
    const newName = ref('')
    const nameInput = ref<HTMLInputElement | null>(null)

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
        if (!name) return
        const stored = ws.add(name)
        if (!stored) {
            notify(`Workspace "${name.trim()}" already exists`, 'error')
            return
        }
        resetAdd()
        await switchTo(stored)
    }

    async function switchTo(name: string) {
        open.value = false
        resetAdd()
        if (name === ws.active) return
        try {
            await uiTransient.withBusy(() => repoStore.switchWorkspace(name), `Switching to ${name}…`)
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
            <button
                v-for="name in ws.names"
                :key="name"
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
                <div class="workspace-add-actions">
                    <button
                        class="btn primary small"
                        @click="confirmAdd()">
                        Add
                    </button>
                    <button
                        class="btn small"
                        @click="resetAdd()">
                        Cancel
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
