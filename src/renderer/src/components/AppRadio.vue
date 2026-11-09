<script setup lang="ts" generic="T extends string | number | boolean">
    defineProps<{
        modelValue?: T
        value?: T
        name?: string
        disabled?: boolean
    }>()

    const emit = defineEmits<{ (event: 'update:modelValue', value: T): void }>()

    function onChange(event: Event) {
        const target = event.target as HTMLInputElement
        if (target.checked) emit('update:modelValue', target.value as T)
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
