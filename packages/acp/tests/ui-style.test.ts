import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unoConfig } from '@vue/devtools-ui/theme'
import { createGenerator, mergeConfigs } from 'unocss'
import { describe, expect, it } from 'vitest'
import { acpUnoConfig } from '../src/ui/uno'

describe('aCP UnoCSS integration', () => {
  it('preserves pipeline filters when merging external UI source scanning', () => {
    const config = mergeConfigs([unoConfig, acpUnoConfig])
    const pipeline = config.content?.pipeline
    expect(pipeline).toBeTruthy()
    if (!pipeline)
      throw new Error('Missing source filters')
    const include = Array.isArray(pipeline.include) ? pipeline.include : [pipeline.include]
    const matches = (id: string) => include.some(pattern => pattern instanceof RegExp && pattern.test(id))
    expect(matches('/packages/acp/src/ui/AcpChat.vue')).toBe(true)
    expect(matches('/node_modules/@shikijs/langs/dist/javascript.mjs')).toBe(false)
    expect(matches('/node_modules/markstream-vue/index.css')).toBe(false)
    expect(config.content?.filesystem).toContain(fileURLToPath(new URL('../src/ui/**/*.{vue,ts}', import.meta.url)))
  })

  it('generates ACP asset-backed and source-declared icons without the client config', async () => {
    const generator = await createGenerator(mergeConfigs([unoConfig, acpUnoConfig]))
    const source = readFileSync(new URL('../src/ui/ComposerSuggestions.vue', import.meta.url), 'utf8')
    const { css } = await generator.generate(source)
    expect(css).toContain('.i-griddy-icons-package')
    expect(css).toContain('.i-mingcute-chat-1-ai-line')
    expect(css).toContain('.i-lucide-box')
    expect(css).toContain('data:image/svg+xml')
  })
})
