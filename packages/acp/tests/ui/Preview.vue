<script setup lang="ts">
import type { ComposerTransport } from '@vue/devtools-acp'
import { AcpChat } from '@vue/devtools-acp/ui'
import { useDevToolsColorMode } from '@vue/devtools-ui'
import { onMounted, ref, shallowRef } from 'vue'
import { fixtureSessions, providers } from './fixtures'

const composerTransport: ComposerTransport = {
  commands: async ({ provider }) => ({ status: 'ready', commands: [
    { id: `${provider}:skill:review-code`, name: 'review-code', description: 'Review the selected changes', kind: 'skill', source: provider, scope: 'skill', execution: 'native' },
    { id: `${provider}:command:check`, name: 'check', description: 'Check the current changes', kind: 'command', source: provider, scope: 'builtin', execution: 'native' },
    ...Array.from({ length: 24 }, (_, index) => ({ id: `${provider}:skill:skill-${index}`, name: `skill-${index}`, description: 'Hidden skill description', kind: 'skill' as const, source: provider, scope: 'skill' as const, execution: 'native' as const })),
  ] }),
  files: async () => ({ files: [{ path: 'src/components/ChatComposer.vue', isDirectory: false }, { path: 'src/components/', isDirectory: true }, { path: 'docs/Project notes.md', isDirectory: false }], truncated: false }),
}

const { isDark } = useDevToolsColorMode()
const params = new URLSearchParams(location.search)
const previewDark = params.has('theme') ? params.get('theme') === 'dark' : isDark.value
onMounted(() => {
  document.documentElement.classList.toggle('dark', previewDark)
  document.documentElement.classList.toggle('light', !previewDark)
})
const sessions = shallowRef(new URLSearchParams(location.search).has('empty') ? [] : fixtureSessions())
const selectedId = ref<string | null>(sessions.value[0]?.id ?? null)
if (params.has('tool-items') && sessions.value[0]) {
  sessions.value[0].tools = []
  sessions.value[0].messages = [
    { id: 'tool-user-1', turnId: 'tool-turn-1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'Check the application entry.' }] },
    { id: 'tool-assistant-1', turnId: 'tool-turn-1', role: 'assistant', createdAt: 2, content: [{ type: 'text', text: 'Checking App.vue. The entry uses RouterView.' }], parts: [
      { type: 'text', text: 'Checking App.vue.' },
      { type: 'tool', tool: { id: 'read-app', messageId: 'tool-assistant-1', turnId: 'tool-turn-1', title: 'cat src/App.vue', status: 'completed', output: 'RouterView' } },
      { type: 'tool', tool: { id: 'read-package', messageId: 'tool-assistant-1', turnId: 'tool-turn-1', title: 'cat package.json', status: 'completed' } },
      { type: 'text', text: 'The entry uses RouterView.' },
    ] },
    { id: 'tool-user-2', turnId: 'tool-turn-2', role: 'user', createdAt: 3, content: [{ type: 'text', text: 'Now check the routes.' }] },
    { id: 'tool-assistant-2', turnId: 'tool-turn-2', role: 'assistant', createdAt: 4, content: [{ type: 'text', text: 'Checking the router. The routes are registered in main.ts.' }], parts: [
      { type: 'text', text: 'Checking the router.' },
      { type: 'tool', tool: { id: 'read-routes', messageId: 'tool-assistant-2', turnId: 'tool-turn-2', title: 'cat src/main.ts', status: 'completed' } },
      { type: 'text', text: 'The routes are registered in main.ts.' },
    ] },
  ]
}
if (params.has('pins') && sessions.value[0]) {
  sessions.value[0].messages = [{ id: 'pin-example', turnId: 'pin-example', role: 'user', createdAt: 1, content: [{ type: 'text', text: '/4.0-app-router Review the application routes.' }], command: { id: 'codex:skill:4.0-app-router', name: '4.0-app-router', kind: 'skill' } }]
}
if (params.has('code-blocks') && sessions.value[0]) {
  const text = [
    'The current `ElTable` props:',
    '',
    '```json',
    '{',
    '  "rowKey": "id",',
    '  "emptyText": "No matching users",',
    '  "data": [',
    '    { "id": 1, "name": "Alice Chen", "email": "alice@example.com", "role": "Admin", "status": "Active" }',
    '  ],',
    '  "stripe": true,',
    '  "border": true,',
    '  "indent": 16,',
    '  "treeProps": { "children": "children", "checkStrictly": false }',
    '}',
    '```',
    '',
    '```ts',
    'const selectedId: number = 1',
    'const selected = rows.find(row => row.id === selectedId)',
    '```',
  ].join('\n')
  sessions.value[0].messages = [{ id: 'code-example', turnId: 'code-example', role: 'assistant', createdAt: 1, content: [{ type: 'text', text }] }]
}
if (params.has('long-model'))
  providers[0].models![0].name = 'Development model with an exceptionally long descriptive name'
if (new URLSearchParams(location.search).has('long') && sessions.value[0]) {
  sessions.value[0].messages[1].parts = undefined
  sessions.value[0].messages[1].content = [{ type: 'text', text: Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: **streamed content** with a [safe link](https://example.com).`).join('\n\n') }]
}
</script>

<template>
  <AcpChat :composer-transport="composerTransport" :sessions="sessions" :selected-id="selectedId" :providers="providers" :connected="true" :is-dark="previewDark" @select-session="selectedId = $event" />
</template>
