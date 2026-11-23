<script setup lang="ts">
    import ILucideFolderPlus from '~icons/lucide/folder-plus'

    const props = withDefaults(
        defineProps<{
            label?: string
        }>(),
        { label: '' }
    )
    const emit = defineEmits<{ (e: 'open'): void }>()

    function open() {
        emit('open')
    }
</script>

<template>
    <div class="open-repo-wrap">
        <button
            v-if="!props.label"
            class="icon-btn tab-new"
            title="Open from local or clone a repository"
            aria-haspopup="dialog"
            @click="open()">
            <i-lucide-folder-plus
                width="15"
                height="15" />
        </button>
        <button
            v-else
            class="btn primary"
            aria-haspopup="dialog"
            @click="open()">
            <i-lucide-folder-plus
                width="15"
                height="15" />
            {{ props.label }}
        </button>
    </div>
</template>
