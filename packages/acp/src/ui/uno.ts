import type { UserConfig } from 'unocss'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function iconRule(name: string): [string, Record<string, string>] {
  return [`i-${name}`, {
    'mask': `url("data:image/svg+xml,${encodeURIComponent(readFileSync(new URL(`./assets/${name}.svg`, import.meta.url), 'utf8'))}") center / contain no-repeat`,
    'background-color': 'currentColor',
    'display': 'inline-block',
    'width': '1em',
    'height': '1em',
  }]
}

export const acpUnoConfig: UserConfig = {
  content: {
    filesystem: [fileURLToPath(new URL('./**/*.{vue,ts}', import.meta.url))],
    // mergeConfigs normalizes omitted pipeline filters to empty arrays.
    pipeline: {
      include: [/\.(vue|svelte|[jt]sx|vine.ts|mdx?|astro|elm|php|phtml|html)($|\?)/],
      exclude: [/\.css($|\?)/],
    },
  },
  theme: {
    fontFamily: { 'data-field': 'Roboto Mono, Menlo, Consolas, monospace' },
  },
  // These icons are newer than the workspace's bundled Iconify collections.
  rules: [iconRule('griddy-icons-package'), iconRule('mingcute-chat-1-ai-line')],
  safelist: ['i-mingcute-chat-1-ai-line'],
}
