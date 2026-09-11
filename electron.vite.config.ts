import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'
import Icons from 'unplugin-icons/vite'

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
        ],
        optimizeDeps: {
            include: ['vue', 'pinia', 'pinia-plugin-persistedstate'],
            entries: ['./src/renderer/src/**/*.vue'],
        },
        build: {
            rollupOptions: {
                input: 'index.html',
            },
        },
    },
})
