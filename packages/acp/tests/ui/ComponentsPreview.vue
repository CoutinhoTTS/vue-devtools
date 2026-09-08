<script setup lang="ts">
import type { ComposerTransport } from '@vue/devtools-acp'
import { AcpChat } from '@vue/devtools-acp/ui'
import { createApp, defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { cancelInspectComponentHighLighter, highlight, inspectComponentInstance, unhighlight } from '../../../devtools-kit/src/core/component-highlighter'
import { createComponentReferenceRegistry } from '../../../devtools-kit/src/core/component/references'
import { providers } from './fixtures'

const target = ref<HTMLElement>()
const appRecord: any = { id: 'preview', instanceMap: new Map(), types: {} }
const registry = createComponentReferenceRegistry({
  getApp: () => appRecord,
  highlight: id => highlight(appRecord.instanceMap.get(id)),
  clear: unhighlight,
})
let sequence = 0
const transport: ComposerTransport = {
  commands: async () => ({ status: 'ready', commands: [] }),
  files: async () => ({ files: [{ path: 'src/Home.vue', isDirectory: false }], truncated: false }),
  components: {
    async pick() {
      const instance = await inspectComponentInstance()
      return instance ? registry.resolve(instance) : null
    },
    cancelPick: async () => cancelInspectComponentHighLighter(),
    capture: async targets => registry.capture(targets),
    list: registry.list,
    validate: async targets => registry.validate(targets),
    highlight: async component => registry.highlight(component, 'preview-client', ++sequence),
  },
}
let app: ReturnType<typeof createApp> | undefined
onMounted(() => {
  const children = Array.from({ length: 40 }, (_, index) => defineComponent({ name: index === 0 ? 'Home' : `Panel${index}`, setup: () => () => h('button', { style: { padding: '8px', border: '1px solid #aaa' } }, index === 0 ? 'Home' : `Panel ${index}`) }))
  app = createApp({ name: 'PreviewRoot', render: () => h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, children.map(child => h(child))) })
  app.mount(target.value!)
  appRecord.app = app
  appRecord.rootInstance = app._instance
  Object.assign(app, { __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: 'preview', __VUE_DEVTOOLS_NEXT_APP_RECORD__: appRecord })
})
onBeforeUnmount(() => {
  registry.highlight(null, 'preview-client', ++sequence)
  app?.unmount()
})
</script>

<template>
  <main style="height:100dvh;display:grid;grid-template-rows:180px minmax(0,1fr)">
    <div ref="target" style="padding:40px 16px 8px;overflow:auto;background:#f5f5f5" />
    <AcpChat :composer-transport="transport" :providers="providers" :connected="true" />
  </main>
</template>
