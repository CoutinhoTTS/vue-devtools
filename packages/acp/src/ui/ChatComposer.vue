<script setup lang="ts">
import type { ComposerCatalog, ComposerContext, ComposerReference, ComposerSelection, ComposerTransport } from '../schema'
import type { ComposerEditorHandle } from './composer-editor'
import type { ChatProvider, ChatSelection } from './types'
import { VueButton, VueSelect } from '@vue/devtools-ui'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { vClosePopper } from 'floating-vue'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import AgentIcon from './AgentIcon.vue'
import ChatIconButton from './ChatIconButton.vue'
import { commandDisplay } from './command-pin'
import { insertComponentReference } from './composer-completion'
import ComposerEditor from './ComposerEditor.vue'
import ComposerSuggestions from './ComposerSuggestions.vue'
import { agentLabel, chatAgents } from './types'
import { useComponentReferences } from './useComponentReferences'
import { useComposerAutocomplete } from './useComposerAutocomplete'

const props = defineProps<{ draft: string, references?: ComposerReference[], selection: ChatSelection, provider?: ChatProvider, providers?: ChatProvider[], catalogReady?: boolean, connected: boolean, running: boolean, agentLocked: boolean, optionsPending?: boolean, blocked?: boolean, context?: ComposerContext, transport?: ComposerTransport, commands?: ComposerCatalog, pinnedCommand?: ComposerSelection }>()
const emit = defineEmits<{ 'update:draft': [value: string], 'selection': [value: ChatSelection], 'send': [], 'stop': [], 'removeCommand': [], 'removeReference': [start: number], 'completion': [value: { text: string, reference?: ComposerReference, command?: ComposerSelection }] }>()
defineSlots<{ tools: () => any }>()
const componentReferences = useComponentReferences(() => props.references ?? [], () => props.transport?.components)
function previewReference(start: number | null) {
  const reference = componentReferences.rows.value.find(reference => reference.start === start)
  void componentReferences.preview(reference && !componentReferences.invalid.value.has(reference.component.instanceToken) ? reference.component : null)
}
const editor = ref<ComposerEditorHandle>()
const editorElement = computed(() => editor.value?.element)
const popupRoot = ref<HTMLElement>()
const popupStyle = ref<Record<string, string>>({})
const composing = ref(false)
const deleteArmed = ref(false)
const suggestionId = `composer-${useId()}`
const autocomplete = useComposerAutocomplete(editor, props, (result, command) => {
  emit('completion', { text: result.text, reference: result.reference, command })
  return command ? Math.max(0, result.cursor - commandDisplay(result.text, command).prefixLength) : result.cursor
})
async function removeCommand() {
  emit('removeCommand')
  deleteArmed.value = false
  await nextTick()
  editor.value?.focus()
}
watch(() => [props.draft, props.pinnedCommand], () => deleteArmed.value = false)
watch(deleteArmed, armed => editorElement.value?.querySelector('[data-command-pin]')?.classList.toggle('armed', armed))
async function positionSuggestions() {
  await nextTick()
  const frame = editorElement.value?.closest('.acp-input-frame')
  const root = editorElement.value?.closest<HTMLElement>('.acp-chat')
  if (!frame || !root)
    return
  const bounds = frame.getBoundingClientRect()
  const parent = root.getBoundingClientRect()
  popupRoot.value = root
  popupStyle.value = { left: `${bounds.left - parent.left}px`, bottom: `${parent.bottom - bounds.top + 8}px`, width: `${Math.min(600, bounds.width)}px`, maxHeight: `${Math.max(80, Math.min(320, bounds.top - parent.top - 16))}px` }
}
watch(() => [autocomplete.visible.value, props.draft], positionSuggestions)
useEventListener('resize', positionSuggestions)
useEventListener('scroll', positionSuggestions, { capture: true })
function input(text: string) {
  emit('update:draft', text)
  autocomplete.syncCursor()
}
const models = computed(() => props.provider?.models ?? [])
const selectedModel = computed(() => models.value.find(m => m.id === props.selection.options.model) ?? models.value.find(m => m.isDefault))
const efforts = computed(() => selectedModel.value?.reasoningEfforts ?? [])
const locked = computed(() => props.running || props.optionsPending || props.blocked)
const modelDisabled = computed(() => locked.value || !(props.connected || props.catalogReady) || props.provider?.modelControl !== 'available' || !models.value.length)
const effortDisabled = computed(() => locked.value || !(props.connected || props.catalogReady) || props.provider?.effortControl !== 'available' || !efforts.value.length)
const agentOptions = computed(() => chatAgents.filter(a => a.value === props.selection.provider || props.providers?.find(p => p.id === a.value)?.installed !== false))
const modelOptions = computed(() => [{ value: '', label: 'Default model' }, ...models.value.map(m => ({ value: m.id, label: m.name }))])
const effortLabels: Record<string, string> = { off: 'Off', none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Max' }
const effortLabel = computed(() => effortLabels[props.selection.options.reasoningEffort ?? ''] ?? props.selection.options.reasoningEffort ?? 'Default thinking')
const effortOptions = computed(() => [{ value: '', label: 'Default thinking' }, ...efforts.value.map(e => ({ value: e, label: effortLabels[e] ?? e }))])
const modelLabel = computed(() => modelOptions.value.find(model => model.value === (props.selection.options.model ?? ''))?.label ?? props.selection.options.model ?? 'Default model')
const canSend = computed(() => props.connected && !locked.value && (!!props.draft.trim() || !!props.pinnedCommand))
const picking = ref(false)
const pickError = ref('')
const pickDisabled = computed(() => !props.connected || locked.value || componentReferences.rows.value.length >= 3)
let pickVersion = 0
function cancelPick() {
  if (!picking.value)
    return
  pickVersion++
  picking.value = false
  void props.transport?.components?.cancelPick?.().catch(() => {})
}
async function pickComponent() {
  if (picking.value) {
    cancelPick()
    return
  }
  const transport = props.transport?.components
  if (!transport?.pick || pickDisabled.value)
    return
  const version = ++pickVersion
  const draft = props.draft
  const cursor = editor.value?.getCursor() ?? draft.length
  picking.value = true
  pickError.value = ''
  autocomplete.keydown(new KeyboardEvent('keydown', { key: 'Escape' }))
  try {
    await componentReferences.preview(null)
    if (version !== pickVersion)
      return
    const component = await transport.pick()
    if (version !== pickVersion || !component)
      return
    if (props.draft !== draft) {
      pickError.value = 'The draft changed. Select the component again.'
      return
    }
    const result = insertComponentReference(draft, cursor, component, props.references)
    emit('completion', result)
    await nextTick()
    editor.value?.focus()
    editor.value?.setCursor(result.cursor)
  }
  catch (error) {
    if (version === pickVersion)
      pickError.value = error instanceof Error ? error.message : 'Unable to select a component'
  }
  finally {
    if (version === pickVersion)
      picking.value = false
  }
}
watch(pickDisabled, disabled => disabled && cancelPick())
useEventListener('keydown', (event) => {
  if (event.key === 'Escape' && picking.value) {
    event.preventDefault()
    cancelPick()
  }
})
onBeforeUnmount(cancelPick)
function changeAgent(provider: string | number | (string | number)[]) {
  if (props.agentLocked || locked.value || !chatAgents.some(a => a.value === provider))
    return
  emit('selection', { provider: provider as ChatSelection['provider'], options: { ...props.selection.options, model: null, reasoningEffort: null } })
}
function changeModel(value: string | number | (string | number)[]) {
  if (Array.isArray(value))
    return
  if (modelDisabled.value)
    return
  const model = String(value) || null
  const next = models.value.find(m => m.id === model) ?? models.value.find(m => m.isDefault)
  const effort = props.selection.options.reasoningEffort
  emit('selection', { ...props.selection, options: { ...props.selection.options, model, reasoningEffort: effort && next?.reasoningEfforts.includes(effort) ? effort : null } })
}
function changeEffort(value: string | number | (string | number)[]) {
  if (Array.isArray(value))
    return
  if (!effortDisabled.value)
    emit('selection', { ...props.selection, options: { ...props.selection.options, reasoningEffort: String(value) || null } })
}
function send() {
  if (canSend.value || props.draft.trim() === '/new' || props.pinnedCommand?.id === 'application:new')
    emit('send')
}
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229)
    return
  if (autocomplete.keydown(event))
    return
  if (['Backspace', 'Delete'].includes(event.key) && !props.draft && props.pinnedCommand && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault()
    if (!event.repeat) {
      if (deleteArmed.value)
        void removeCommand()
      else
        deleteArmed.value = true
    }
    return
  }
  deleteArmed.value = false
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing.value || event.keyCode === 229)
    return
  event.preventDefault()
  send()
}
async function resize() {
  await nextTick()
  if (!editorElement.value)
    return
  editorElement.value.style.height = 'auto'
  editorElement.value.style.height = `${Math.min(240, Math.max(24, editorElement.value.scrollHeight))}px`
}
watch(() => props.draft, resize, { immediate: true })
let previousWidth = 0
useResizeObserver(editorElement, ([entry]) => {
  void positionSuggestions()
  if (entry && entry.contentRect.width !== previousWidth) {
    previousWidth = entry.contentRect.width
    void resize()
  }
})
function controlLabel(kind: 'model' | 'effort') {
  if (props.optionsPending)
    return 'Applying configuration'
  if (!(props.connected || props.catalogReady))
    return 'Not connected'
  if (props.running)
    return 'Available when the current turn finishes'
  const status = kind === 'model' ? props.provider?.modelControl : props.provider?.effortControl
  return status === 'unsupported' ? 'Not supported by this agent' : status === 'loading' || !status ? 'Loading options' : kind === 'model' ? 'Model' : 'Thinking level'
}
</script>

<template>
  <div class="acp-composer">
    <p v-if="pickError" class="acp-error" role="alert">
      {{ pickError }}
    </p>
    <div class="acp-input-frame">
      <Teleport v-if="autocomplete.visible.value" :to="popupRoot ?? 'body'" :disabled="!popupRoot">
        <ComposerSuggestions :id="suggestionId" :style="popupStyle" :rows="autocomplete.rows.value" :selected="autocomplete.selected.value" :status="autocomplete.status.value" :loading="autocomplete.loading.value" @select="autocomplete.selected.value = $event" @accept="autocomplete.accept" @retry="autocomplete.retry" />
      </Teleport>
      <ComposerEditor ref="editor" :model-value="draft" :command="pinnedCommand" :references="references" :invalid-references="componentReferences.invalid.value" aria-autocomplete="list" :aria-expanded="autocomplete.visible.value" :aria-controls="autocomplete.visible.value ? suggestionId : undefined" :aria-activedescendant="autocomplete.visible.value && autocomplete.rows.value.length ? `${suggestionId}-${autocomplete.selected.value}` : undefined" @remove-reference="emit('removeReference', $event)" @preview-reference="previewReference" @update:model-value="input" @selection-change="autocomplete.syncCursor" @remove-command="removeCommand" @focus="autocomplete.focused.value = true; autocomplete.syncCursor()" @blur="autocomplete.focused.value = false" @click="autocomplete.syncCursor" @select="autocomplete.syncCursor" @keyup="autocomplete.syncCursor" @compositionstart="composing = true; autocomplete.composing.value = true" @compositionend="composing = false; autocomplete.composing.value = false; autocomplete.syncCursor()" @keydown="onKeydown" />
      <div class="acp-input-actions">
        <div class="acp-composer-controls">
          <div class="acp-control" title="Agent">
            <VueSelect :model-value="selection.provider" :options="agentOptions" :disabled="agentLocked || locked" @update:model-value="changeAgent">
              <template #button>
                <VueButton flat class="acp-select-trigger" :disabled="agentLocked || locked" aria-label="Agent" :title="agentLabel(selection.provider)">
                  <template #icon>
                    <AgentIcon :provider="selection.provider" />
                  </template>
                  {{ agentLabel(selection.provider) }}
                  <template #icon-right>
                    <span i-carbon-chevron-down aria-hidden="true" />
                  </template>
                </VueButton>
              </template>
              <template #item="{ item, active, disabled }">
                <VueButton v-close-popper flat class="acp-agent-option" :class="{ active }" :disabled="disabled" :aria-pressed="active">
                  <template #icon>
                    <AgentIcon :provider="item.value" />
                  </template>
                  {{ item.label }}
                  <template #icon-right>
                    <span class="i-carbon-checkmark" :style="{ visibility: active ? 'visible' : 'hidden' }" aria-hidden="true" />
                  </template>
                </VueButton>
              </template>
            </VueSelect>
          </div>
          <div class="acp-control" :title="controlLabel('model')">
            <VueSelect :model-value="selection.options.model ?? ''" :options="modelOptions" :disabled="modelDisabled" @update:model-value="changeModel">
              <template #button>
                <VueButton flat class="acp-select-trigger" :disabled="modelDisabled" aria-label="Model" :title="`${controlLabel('model')}: ${modelLabel}`">
                  {{ modelLabel }}
                  <template #icon-right>
                    <span i-carbon-chevron-down aria-hidden="true" />
                  </template>
                </VueButton>
              </template>
            </VueSelect>
          </div>
          <div class="acp-control acp-thinking-control" :data-effort="selection.options.reasoningEffort || 'default'" :title="controlLabel('effort')">
            <VueSelect :model-value="selection.options.reasoningEffort ?? ''" :options="effortOptions" :disabled="effortDisabled" @update:model-value="changeEffort">
              <template #button>
                <VueButton flat class="acp-select-trigger" :disabled="effortDisabled" aria-label="Thinking level" :title="`${controlLabel('effort')}: ${effortLabel}`">
                  <template #icon>
                    <span i-lucide-brain aria-hidden="true" />
                  </template>
                  {{ effortLabel }}
                  <template #icon-right>
                    <span i-carbon-chevron-down aria-hidden="true" />
                  </template>
                </VueButton>
              </template>
            </VueSelect>
          </div>
          <slot name="tools" />
          <ChatIconButton v-if="transport?.components?.pick" :label="picking ? 'Cancel component selection' : 'Select component in the page'" icon="i-carbon-select-01" :disabled="!picking && pickDisabled" :aria-pressed="picking" @mousedown.prevent @click="pickComponent" />
        </div>
        <VueButton v-if="running" flat class="acp-icon-button acp-send-button" :disabled="!connected" aria-label="Stop response" title="Stop response" @click="connected && emit('stop')">
          <template #icon>
            <span i-lucide-circle-stop aria-hidden="true" />
          </template>
        </VueButton>
        <VueButton v-else flat class="acp-icon-button acp-send-button" :disabled="!canSend" aria-label="Send message" title="Send message" @click="send">
          <template #icon>
            <span i-lets-icons-send-hor aria-hidden="true" />
          </template>
        </VueButton>
      </div>
    </div>
  </div>
</template>
