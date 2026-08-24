<script setup lang="ts">
    import { Plus, X } from 'lucide-vue-next'

    interface Tab {
        path: string
        name: string
    }

    defineProps<{ tabs: Tab[]; activeIndex: number }>()
    const emit = defineEmits<{ (e: 'select', index: number): void; (e: 'close', index: number): void; (e: 'open-new'): void }>()
</script>

<template>
    <div
        v-if="tabs.length"
        class="tab-bar">
        <div
            v-for="(tab, index) in tabs"
            :key="tab.path"
            class="repo-tab"
            :class="{ active: index === activeIndex }"
            :title="tab.path"
            @click="emit('select', index)">
            <span>{{ tab.name }}</span>
            <button
                class="icon-btn tab-close"
                :title="`Close ${tab.name}`"
                @click.stop="emit('close', index)">
                <X :size="12" />
            </button>
        </div>
        <button
            class="icon-btn tab-new"
            title="Open another repository"
            @click="emit('open-new')">
            <Plus :size="15" />
        </button>
    </div>
</template>
