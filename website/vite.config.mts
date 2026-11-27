import { fileURLToPath } from 'url'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = fileURLToPath(new URL('.', import.meta.url))

// The landing page: a plain Vite + React build, separate from the Electron app (yarn site:dev / site:build).
// It shares the renderer's motion curves through the same '@' alias and the app icon from build/.
export default defineConfig({
  root: here,
  base: './',
  publicDir: false,
  resolve: { alias: { '@': resolve(here, '../src/renderer/src') } },
  plugins: [react()],
  server: { fs: { allow: [resolve(here, '..')] } },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true }
})
