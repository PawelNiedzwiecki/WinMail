import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Main and preload externalize node_modules by default (build.externalizeDeps).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') }
    },
    plugins: [react()]
  }
})
