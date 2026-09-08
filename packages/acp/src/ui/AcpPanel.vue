<script setup lang="ts">
import type { AcpTransport } from './transport'
import type { ChatAgent } from './types'
import { onBeforeUnmount, onMounted } from 'vue'
import AcpChat from './AcpChat.vue'
import { useAgentCatalog } from './useAgentCatalog'
import { useAgentChat } from './useAgentChat'

const props = defineProps<{ transport: AcpTransport, isDark?: boolean }>()
const chat = useAgentChat(props.transport.chat)
const catalog = useAgentCatalog(props.transport.catalog)
let disposed = false

async function connect() {
  if (disposed)
    return
  try {
    await props.transport.connect()
    if (!disposed)
      await chat.start()
  }
  catch (error) {
    if (!disposed)
      chat.error.value = error instanceof Error ? error.message : 'Unable to connect to agents'
  }
}

onMounted(async () => {
  await catalog.detect()
  if (!disposed && catalog.available.value)
    await catalog.load('kimi')
  await connect()
})
onBeforeUnmount(() => disposed = true)

async function refreshAgent(agent: ChatAgent) {
  if (!chat.connected.value)
    await connect()
  if (disposed)
    return
  await catalog.detect()
  if (!disposed && catalog.available.value)
    await catalog.load(agent, true)
}
</script>

<template>
  <AcpChat :composer-transport="transport.composer" :is-dark="isDark" :sessions="chat.sessions.value" :selected-id="chat.selectedId.value" :connected="chat.connected.value" :submitting="chat.submitting.value" :accepted="chat.accepted.value" :chat-error="chat.error.value" :providers="catalog.providers.value" :catalog-ready="catalog.available.value" :catalog-error="catalog.error.value" @select-session="chat.select" @send="chat.send" @stop="chat.stop" @permission="chat.permission" @answer="chat.answer" @change-options="chat.changeOptions" @agent-selected="catalog.load($event)" @refresh-agent="refreshAgent" />
</template>
