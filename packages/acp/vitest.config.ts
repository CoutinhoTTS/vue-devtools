import Vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        root: import.meta.dirname,
        test: { name: 'node', environment: 'node', include: ['tests/*.test.ts'] },
      },
      {
        root: import.meta.dirname,
        plugins: [Vue()],
        test: { name: 'ui', environment: 'jsdom', include: ['tests/ui/*.test.ts'] },
      },
    ],
  },
})
