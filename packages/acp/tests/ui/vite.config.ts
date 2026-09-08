import { fileURLToPath } from 'node:url'
import Vue from '@vitejs/plugin-vue'
import { unoConfig } from '@vue/devtools-ui/theme'
import { mergeConfigs } from 'unocss'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import { acpUnoConfig } from '../../src/ui/uno'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [Vue(), UnoCSS(mergeConfigs([unoConfig, acpUnoConfig]))],
})
