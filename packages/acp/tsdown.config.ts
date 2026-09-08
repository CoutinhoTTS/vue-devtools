import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node/index.ts' },
  clean: true,
  format: ['esm', 'cjs'],
  fixedExtension: false,
  dts: true,
  hash: false,
  ignoreWatch: ['.turbo'],
})
