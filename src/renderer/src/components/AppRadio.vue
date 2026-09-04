<script setup lang="ts">
    defineProps<{
        modelValue?: string | number | boolean
        value?: string | number | boolean
        name?: string
        disabled?: boolean
    }>()

    const emit = defineEmits<{ (event: 'update:modelValue', value: string | number | boolean): void }>()

    function onChange(event: Event) {
        const target = event.target as HTMLInputElement
        if (target.checked) emit('update:modelValue', target.value)
    }
</script>

<template>
    <label class="cbx18">
        <input
            class="cbx18-input"
            type="radio"
            :name="name"
            :value="value"
            :checked="modelValue === value"
            :disabled="disabled"
            @change="onChange" />
        <span
            class="round-box"
            aria-hidden="true"></span>
        <span
            v-if="$slots.default"
            class="cbx18-text"
            ><slot
        /></span>
    </label>
</template>
