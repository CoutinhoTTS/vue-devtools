<script setup lang="ts">
import { AcpPanel, createAcpTransport } from '@vue/devtools-acp/ui'
import { rpc, viteRpc } from '@vue/devtools-core'
import { useDevToolsColorMode } from '@vue/devtools-ui'

const { isDark } = useDevToolsColorMode()
const transport = createAcpTransport({
  chat: {
    list: token => viteRpc.value.getAgentSessions(token),
    send: (token, input) => viteRpc.value.sendAgentMessage(token, input),
    stop: (token, id) => viteRpc.value.stopAgentMessage(token, id),
    permission: (token, id, response) => viteRpc.value.respondAgentPermission(token, id, response),
    answer: (token, id, response) => viteRpc.value.respondAgentQuestion(token, id, response),
    options: (token, id, options) => viteRpc.value.updateAgentOptions(token, id, options),
  },
  catalog: {
    detect: () => viteRpc.value.getAgentDetections(),
    probe: (agent, refresh) => viteRpc.value.getAgentModels(agent, refresh),
  },
  composer: {
    commands: (token, context, refresh) => viteRpc.value.getAgentCommands(token, context, refresh),
    files: (token, query) => viteRpc.value.getAgentFiles(token, query),
  },
  components: {
    async pick() {
      await rpc.value.emit('toggle-panel', false)
      try {
        return await rpc.value.inspectComponentReference()
      }
      finally {
        await rpc.value.emit('toggle-panel', true)
      }
    },
    cancelPick: () => rpc.value.cancelInspectComponentInspector(),
    capture: components => rpc.value.captureComponentReferences(components),
    list: query => rpc.value.getComponentCandidates(query),
    validate: components => rpc.value.validateComponentReferences(components),
    highlight: (component, clientId, sequence) => rpc.value.highlightComponentReference(component, clientId, sequence),
  },
})
</script>

<template>
  <AcpPanel :transport="transport" :is-dark="isDark" />
</template>
