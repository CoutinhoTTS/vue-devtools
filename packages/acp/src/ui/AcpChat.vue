<script setup lang="ts">
import type { ComposerReference, ComposerSelection, ComposerTransport, PermissionResponse, UserInputResponse } from '../schema'
import type { ChatProvider, ChatSelection, ChatSend, ChatSession } from './types'
import { VueDrawer } from '@vue/devtools-ui'
import { useElementSize } from '@vueuse/core'
import { useFocusTrap } from '@vueuse/integrations/useFocusTrap'
import { computed, nextTick, ref, watch } from 'vue'
import { captureReferences } from './capture-references'
import ChatComposer from './ChatComposer.vue'
import ChatIconButton from './ChatIconButton.vue'
import ChatMessages from './ChatMessages.vue'
import ChatRequests from './ChatRequests.vue'
import ChatSessionList from './ChatSessionList.vue'
import { commandDisplay, pinnedSubmission } from './command-pin'
import { updateReferences } from './composer-completion'
import { defaultSelection, isRunning } from './types'
import './chat.css'

const props = withDefaults(defineProps<{ sessions?: ChatSession[], selectedId?: string | null, providers?: ChatProvider[], connected?: boolean, catalogReady?: boolean, catalogError?: string, isDark?: boolean, submitting?: boolean, chatError?: string, accepted?: { key: string, content: string, sequence: number }, composerTransport?: ComposerTransport }>(), { sessions: () => [], selectedId: null, providers: () => [], connected: false, catalogReady: false, isDark: false })
const emit = defineEmits<{ agentSelected: [agent: ChatSelection['provider']], refreshAgent: [agent: ChatSelection['provider']], selectSession: [id: string | null], newChat: [], send: [value: ChatSend], stop: [sessionId: string], changeOptions: [value: ChatSelection & { sessionId: string }], permission: [value: { sessionId: string, response: PermissionResponse }], answer: [value: { sessionId: string, response: UserInputResponse }] }>()
const root = ref<HTMLElement>()
const { width } = useElementSize(root)
const bottom = ref<HTMLElement>()
const { height: bottomHeight } = useElementSize(bottom, { width: 0, height: 114 }, { box: 'border-box' })
const narrow = computed(() => width.value < 640)
const drawer = ref(false)
const drawerContent = ref<HTMLElement>()
const { activate, deactivate } = useFocusTrap(drawerContent, { escapeDeactivates: false, allowOutsideClick: true })
const activeId = ref<string | null>(props.selectedId)
watch(() => props.selectedId, id => activeId.value = id)
const current = computed(() => props.sessions.find(s => s.id === activeId.value))
const key = computed(() => current.value?.id ?? '__new__')
const drafts = ref<Record<string, string>>({})
const references = ref<Record<string, ComposerReference[]>>({})
const commands = ref<Record<string, ComposerSelection | undefined>>({})
const composerError = ref('')
const capturing = ref(false)
watch(() => props.accepted, (value) => {
  if (value && pinnedSubmission(drafts.value[value.key] ?? '', commands.value[value.key]).content.trim() === value.content.trim()) {
    drafts.value[value.key] = ''
    references.value[value.key] = []
    commands.value[value.key] = undefined
  }
})
const newSelection = ref(defaultSelection())
const remembered = new Map<ChatSelection['provider'], ChatSelection>()
const selection = computed<ChatSelection>(() => current.value ? { provider: current.value.provider, options: current.value.options } : newSelection.value)
const draft = computed({ get: () => drafts.value[key.value] ?? '', set: (value) => {
  references.value[key.value] = updateReferences(drafts.value[key.value] ?? '', value, references.value[key.value] ?? [])
  drafts.value[key.value] = value
  composerError.value = ''
} })
function complete(value: { text: string, reference?: ComposerReference, command?: ComposerSelection }) {
  draft.value = value.text
  if (value.reference)
    (references.value[key.value] ??= []).push(value.reference)
  if (value.command) {
    const display = commandDisplay(value.text, value.command)
    draft.value = display.text
    commands.value[key.value] = value.command
  }
}
const running = computed(() => isRunning(current.value?.status))
watch(() => selection.value.provider, agent => emit('agentSelected', agent))
watch(narrow, () => drawer.value = false)
watch(drawer, async (open) => {
  await nextTick()
  if (open)
    activate()
  else deactivate()
})
function select(id: string | null) {
  activeId.value = id
  drawer.value = false
  emit('selectSession', id)
}
function newChat() {
  select(null)
  emit('newChat')
}
function changeOptions(value: ChatSelection) {
  if (current.value) {
    emit('changeOptions', { sessionId: current.value.id, ...value })
  }
  else {
    const previous = newSelection.value
    if (value.provider !== previous.provider)
      commands.value[key.value] = undefined
    remembered.set(previous.provider, structuredClone({ provider: previous.provider, options: { ...previous.options } }))
    newSelection.value = value.provider === previous.provider ? value : remembered.get(value.provider) ?? value
  }
}
async function send() {
  if (capturing.value)
    return
  const submission = pinnedSubmission(draft.value, commands.value[key.value], references.value[key.value])
  if (submission.content.trim() === '/new') {
    newChat()
    if (pinnedSubmission(draft.value, commands.value[key.value]).content.trim() === '/new') {
      draft.value = ''
      commands.value[key.value] = undefined
    }
    return
  }
  if (submission.content.trimStart().startsWith('/new ')) {
    composerError.value = 'New conversation does not accept arguments'
    return
  }
  if (!props.connected || props.submitting || running.value || current.value?.optionsPending || current.value?.permission || current.value?.question || !submission.content.trim())
    return
  const selectedKey = key.value
  const originalDraft = draft.value
  const message = { sessionId: current.value?.id ?? null, ...selection.value, ...submission }
  composerError.value = ''
  if (!submission.references?.some(reference => reference.kind === 'component')) {
    emit('send', message)
    return
  }
  capturing.value = true
  try {
    const captured = await captureReferences(submission.references, props.composerTransport?.components)
    if (key.value !== selectedKey || draft.value !== originalDraft)
      throw new Error('The draft changed during capture. Send again.')
    if (!props.connected || props.submitting || running.value)
      throw new Error('Unable to send now. Please try again.')
    emit('send', { ...message, references: captured })
  }
  catch (error) {
    composerError.value = error instanceof Error ? error.message : 'Unable to capture component context'
  }
  finally { capturing.value = false }
}
function stop() {
  if (current.value && props.connected)
    emit('stop', current.value.id)
}
function removeReference(start: number) {
  const reference = references.value[key.value]?.find(reference => reference.start === start)
  if (reference)
    draft.value = draft.value.slice(0, reference.start) + draft.value.slice(reference.end)
}
function permission(response: PermissionResponse) {
  if (current.value && props.connected)
    emit('permission', { sessionId: current.value.id, response })
}
function answer(response: UserInputResponse) {
  if (current.value && props.connected)
    emit('answer', { sessionId: current.value.id, response })
}
</script>

<template>
  <section ref="root" class="acp-chat" :class="{ 'acp-narrow': narrow }" aria-label="ACP chat">
    <aside v-if="!narrow" class="acp-sidebar">
      <ChatSessionList :sessions="sessions" :selected-id="current?.id ?? null" @select="select" @new-chat="newChat" />
    </aside>
    <div class="acp-main" :style="{ '--acp-bottom-height': `${bottomHeight}px` }">
      <ChatMessages :session-key="key" :bottom-inset="bottomHeight" :messages="current?.messages ?? []" :running="running" :error="current?.error" :is-dark="isDark" />
      <div ref="bottom" class="acp-bottom">
        <p v-if="composerError" class="acp-error" role="alert">
          {{ composerError }}
        </p>
        <p v-if="chatError" class="acp-error" role="alert">
          {{ chatError }}
        </p>
        <div v-if="catalogError || providers.find(p => p.id === selection.provider)?.error" class="acp-error" role="alert">
          {{ catalogError || providers.find(p => p.id === selection.provider)?.error }}
        </div>
        <ChatRequests :key="key" :permission="current?.permission" :question="current?.question" :pending="current?.requestPending" :error="current?.requestError" :connected="connected" @permission="permission" @answer="answer" />
        <p v-if="current?.optionsError" class="acp-error" role="alert">
          {{ current.optionsError }}
        </p>
        <ChatComposer :key="key" v-model:draft="draft" :references="references[key]" :pinned-command="commands[key]" :context="{ provider: selection.provider, sessionId: current?.id?.startsWith('pending:') ? null : current?.id ?? null }" :transport="composerTransport" :commands="current?.commands" :selection="selection" :provider="providers.find(p => p.id === selection.provider)" :providers="providers" :catalog-ready="catalogReady" :connected="connected" :running="running" :agent-locked="!!current?.messages.length" :options-pending="current?.optionsPending" :blocked="capturing || submitting || !!(current?.permission || current?.question)" @remove-reference="removeReference" @remove-command="commands[key] = undefined" @completion="complete" @selection="changeOptions" @send="send" @stop="stop">
          <template #tools>
            <ChatIconButton v-if="narrow" label="Toggle conversations" icon="i-carbon-side-panel-open" :aria-expanded="drawer" @click="drawer = !drawer" />
            <ChatIconButton :label="providers.find(p => p.id === selection.provider)?.refreshing ? 'Loading models...' : 'Refresh agent models'" icon="i-carbon-renew" :disabled="providers.find(p => p.id === selection.provider)?.refreshing" :aria-busy="providers.find(p => p.id === selection.provider)?.refreshing" @click="emit('refreshAgent', selection.provider)" />
            <span v-if="providers.find(p => p.id === selection.provider)?.installed === false" class="acp-catalog-status">Agent not installed</span>
          </template>
        </ChatComposer>
      </div>
    </div>
    <VueDrawer v-if="root && narrow" v-model="drawer" :mount-to="root" placement="left" position="absolute" :closable="true" :close-outside="true" :dim="true" content-class="acp-session-drawer">
      <div ref="drawerContent" role="dialog" aria-label="Conversations" aria-modal="true" @keydown.esc="drawer = false">
        <ChatIconButton label="Close conversations" icon="i-carbon-close" @click="drawer = false" />
        <ChatSessionList :sessions="sessions" :selected-id="current?.id ?? null" @select="select" @new-chat="newChat" />
      </div>
    </VueDrawer>
  </section>
</template>
