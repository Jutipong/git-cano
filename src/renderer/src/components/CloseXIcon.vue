<template>
    <!-- circle + X drawn in one SVG so they are always exactly concentric -->
    <svg
        class="close-x-svg"
        viewBox="0 0 22 22"
        aria-hidden="true">
        <circle
            class="close-x-ring"
            cx="11"
            cy="11"
            r="10.5" />
        <path
            class="close-x-mark"
            d="M14.75 7.25L7.25 14.75M7.25 7.25l7.5 7.5" />
    </svg>
</template>
