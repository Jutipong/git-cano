import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'
import AutoImport from 'unplugin-auto-import/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
    main: {
        resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') },
        },
        build: {
            rollupOptions: {
                external: ['electron', 'simple-git'],
            },
        },
    },
    preload: {
        resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') },
        },
    },
    renderer: {
        root: 'src/renderer',
        resolve: {
            alias: {
                '@shared': resolve(__dirname, 'src/shared'),
                '@': resolve(__dirname, 'src/renderer/src'),
            },
        },
        plugins: [
            vue(),
            Icons({
                compiler: 'vue3',
                autoInstall: false,
            }),
            AutoImport({
                imports: [
                    {
                        vue: [
                            'ref',
                            'reactive',
                            'computed',
                            'watch',
                            'watchEffect',
                            'defineProps',
                            'defineEmits',
                            'onMounted',
                            'onBeforeUnmount',
                            'onUnmounted',
                            'toRefs',
                            'provide',
                            'inject',
                        ],
                        pinia: ['defineStore', 'storeToRefs'],
                    },
                ],
                dirs: ['src/stores/**', 'src/utils/**'],
                dts: 'src/auto-imports.d.ts',
            }),
            Components({
                dirs: ['src/components'],
                dts: 'src/components.d.ts',
                resolvers: [
                    // <i-lucide-git-branch /> -> inline SVG component at compile time (zero runtime)
                    IconsResolver({ prefix: 'i', enabledCollections: ['lucide'] }),
                ],
            }),
        ],
        optimizeDeps: {
            include: ['vue', 'pinia', 'pinia-plugin-persistedstate'],
            entries: ['./src/renderer/src/**/*.vue'],
        },
        build: {
            rollupOptions: {
                input: resolve(__dirname, 'src/renderer/index.html'),
            },
        },
    },
})
