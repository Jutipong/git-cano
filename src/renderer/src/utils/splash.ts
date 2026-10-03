/**
 * Minimum time the splash stays on screen — shared by the boot restore and workspace switches so both
 * feel identical. `App.vue` stabilizes the visible flag with `useMinVisible` against this value.
 */
export const SPLASH_MIN_MS = 1000
