<script setup lang="ts">
    defineProps<{ modelValue?: boolean; disabled?: boolean }>()

    const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

    function onChange(event: Event) {
        emit('update:modelValue', (event.target as HTMLInputElement).checked)
    }
</script>

<template>
    <label class="cbx19">
        <input
            type="checkbox"
            :checked="modelValue ?? false"
            :disabled="disabled"
            @change="onChange" />
        <span
            class="check-box"
            aria-hidden="true"></span>
        <span
            v-if="$slots.default"
            class="cbx19-text"
            ><slot
        /></span>
    </label>
</template>
