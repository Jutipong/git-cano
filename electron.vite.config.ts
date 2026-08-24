import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    build: {
      rollupOptions: {
        external: ['simple-git'],
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
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
})
