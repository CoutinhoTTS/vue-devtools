<script setup lang="ts">
import type { ChatMessage } from './types'
import { VueLoadingIndicator } from '@vue/devtools-ui'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import MarkdownRender, { removeCustomComponents, setCustomComponents } from 'markstream-vue'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import ChatCodeBlock from './ChatCodeBlock.vue'
import ChatIconButton from './ChatIconButton.vue'
import { commandDisplay } from './command-pin'
import CommandPin from './CommandPin.vue'
import { groupMessageTools } from './tool-groups'
import ToolCallGroup from './ToolCallGroup.vue'
import 'markstream-vue/index.css'

const props = defineProps<{ sessionKey: string, messages: ChatMessage[], running: boolean, error?: string, isDark?: boolean, bottomInset?: number }>()
const markdownId = `devtools-acp-${useId()}`
setCustomComponents(markdownId, { code_block: ChatCodeBlock })
onBeforeUnmount(() => removeCustomComponents(markdownId))
const displayMessages = computed(() => props.messages.map(message => ({
  message,
  parts: groupMessageTools(message.parts ?? [{ type: 'text' as const, text: messageText(message) }]),
})))
const viewport = ref<HTMLElement>()
const content = ref<HTMLElement>()
const pinned = ref(true)
const copied = ref<string | null>(null)
const copyError = ref('')
function messageText(message: ChatMessage) {
  return message.content.map(c => c.type === 'text' ? c.text : c.name).join('\n')
}
function userParts(message: ChatMessage) {
  const display = commandDisplay(messageText(message), message.command)
  const result: { text?: string, name?: string, title?: string }[] = []
  let offset = 0
  for (const reference of [...(message.references ?? [])].sort((a, b) => a.start - b.start)) {
    if (reference.kind !== 'component')
      continue
    const start = reference.start - display.prefixLength
    const end = reference.end - display.prefixLength
    if (start < offset || end > display.text.length)
      continue
    result.push({ text: display.text.slice(offset, start) }, { name: reference.component.name, title: reference.snapshot?.component.file ?? reference.component.parentPath })
    offset = end
  }
  result.push({ text: display.text.slice(offset) })
  return result
}
function jump() {
  if (viewport.value)
    viewport.value.scrollTop = viewport.value.scrollHeight
  pinned.value = true
}
function trackScroll() {
  const el = viewport.value
  if (el)
    pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}
async function follow() {
  const shouldFollow = pinned.value
  await nextTick()
  if (shouldFollow && pinned.value)
    jump()
}
watch(() => props.sessionKey, async () => {
  pinned.value = true
  copied.value = null
  copyError.value = ''
  await nextTick()
  jump()
})
watch(() => [props.messages.map(m => messageText(m)).join(''), props.messages.map(m => m.parts?.length ?? 0).join(','), props.running], follow, { flush: 'post', immediate: true })
useResizeObserver(content, follow)
watch(() => props.bottomInset, follow)
useMutationObserver(content, follow, { subtree: true, childList: true, characterData: true })
async function copy(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(messageText(message))
    copied.value = message.id
    copyError.value = ''
  }
  catch { copyError.value = 'Unable to copy message' }
}
function safeMarkdown(md: any) {
  md.set({ html: false })
  md.disable(['image'])
  const validate = md.validateLink.bind(md)
  md.validateLink = (url: string) => validate(url) && /^(?:https?:|mailto:|#|\/)/i.test(url) && !url.startsWith('//')
  return md
}
</script>

<template>
  <div class="acp-messages-shell">
    <div ref="viewport" class="acp-messages-scroll" role="region" aria-label="Messages" tabindex="0" @scroll="trackScroll">
      <div ref="content" class="acp-messages-content">
        <div v-if="!messages.length && !running" class="acp-empty-chat">
          <span i-mingcute-chat-1-ai-line aria-hidden="true" /><h2>New conversation</h2>
        </div>
        <article v-for="{ message, parts } in displayMessages" :key="message.id" class="acp-message" :class="message.role" :data-message-id="message.id" :data-turn-id="message.turnId" :aria-label="message.role === 'user' ? 'You' : 'Assistant'">
          <div v-if="message.role === 'user'" class="acp-user-text">
            <span v-if="message.delivery === 'sending'" class="acp-delivery" role="status" aria-label="Sending message" title="Sending message"><VueLoadingIndicator /></span>
            <span v-else-if="message.delivery === 'failed'" class="acp-delivery acp-error-text" role="status" aria-label="Message not sent" title="Message not sent"><span i-carbon-warning-alt aria-hidden="true" /></span>
            <CommandPin v-if="commandDisplay(messageText(message), message.command).command" :command="commandDisplay(messageText(message), message.command).command!" />
            <span v-if="commandDisplay(messageText(message), message.command).text" class="acp-user-body"><template v-for="(part, index) in userParts(message)" :key="index"><span v-if="part.name" class="acp-command-pin" :title="part.title"><span class="i-lucide-box acp-pin-icon" aria-hidden="true" /><span class="acp-pin-label">{{ part.name }}</span></span><template v-else>{{ part.text }}</template></template></span>
          </div>
          <template v-else>
            <template v-for="(part, index) in parts" :key="part.key">
              <MarkdownRender v-if="part.type === 'text'" :content="part.text" :final="!message.streaming || index < parts.length - 1" mode="chat" :is-dark="isDark" html-policy="escape" :custom-html-tags="[]" :custom-markdown-it="safeMarkdown" :custom-id="markdownId" code-renderer="pre" />
              <ToolCallGroup v-else :tools="part.tools" />
            </template>
          </template>
          <div v-if="messageText(message).trim()" class="acp-message-actions">
            <ChatIconButton :label="copied === message.id ? 'Copied' : 'Copy message'" :icon="copied === message.id ? 'i-carbon-checkmark' : 'i-carbon-copy'" @click="copy(message)" />
          </div>
        </article>
        <div v-if="running" class="acp-working" role="status">
          <span aria-hidden="true"><VueLoadingIndicator /></span>Working...
        </div>
        <p v-if="error" role="alert" class="acp-error">
          {{ error }}
        </p>
        <p v-if="copyError" role="alert" class="acp-error">
          {{ copyError }}
        </p>
      </div>
    </div>
    <div v-if="!pinned" class="acp-jump">
      <ChatIconButton label="Scroll to bottom" icon="i-carbon-arrow-down" @click="jump" />
    </div>
  </div>
</template>
