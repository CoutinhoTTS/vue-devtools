import { fileURLToPath } from 'node:url'
import Vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [Vue()],
  test: { environment: 'jsdom', include: ['tests/ui/*.test.ts'] },
})
