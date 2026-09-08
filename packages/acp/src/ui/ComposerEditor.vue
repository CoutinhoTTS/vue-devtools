<script setup lang="ts">
import type { ComposerReference, ComposerSelection } from '../schema'
import { nextTick, onMounted, ref, watch } from 'vue'
import { editorCursor, editorRange, editorText, pinSelector, plainTextFragment, renderEditor, setEditorCursor } from './composer-editor'

const props = defineProps<{ modelValue: string, command?: ComposerSelection, references?: ComposerReference[], invalidReferences?: Set<string> }>()
const emit = defineEmits<{ 'update:modelValue': [text: string], 'removeCommand': [], 'removeReference': [start: number], 'previewReference': [start: number | null], 'selectionChange': [], 'compositionstart': [event: CompositionEvent], 'compositionend': [event: CompositionEvent] }>()
const element = ref<HTMLDivElement>()
let composing = false
let renderedCommand: string | undefined

function sync() {
  const editor = element.value
  if (!editor || composing)
    return
  const identity = JSON.stringify([props.command, props.references, [...(props.invalidReferences ?? [])]])
  const pin = editor.querySelector(pinSelector)
  if (editorText(editor) === props.modelValue && renderedCommand === identity && !!pin === !!props.command)
    return
  const focused = editor.ownerDocument.activeElement === editor
  const cursor = editorCursor(editor)
  renderEditor(editor, props.modelValue, props.command, props.references, props.invalidReferences)
  renderedCommand = identity
  if (focused)
    setEditorCursor(editor, Math.min(cursor, props.modelValue.length))
}
function input() {
  if (!element.value || composing)
    return
  if (props.command && !element.value.querySelector(pinSelector))
    emit('removeCommand')
  emit('update:modelValue', editorText(element.value))
  emit('selectionChange')
}
function focus() {
  element.value?.focus({ preventScroll: true })
}
function setCursor(offset: number) {
  sync()
  if (element.value)
    setEditorCursor(element.value, offset)
}
function insert(text: string) {
  const editor = element.value
  if (!editor)
    return
  const range = editorRange(editor)
  if (!range)
    return
  const fragment = plainTextFragment(text, editor.ownerDocument)
  const last = fragment.lastChild!
  range.deleteContents()
  range.insertNode(fragment)
  range.setStartAfter(last)
  range.collapse(true)
  const selection = editor.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  input()
}
function paste(event: ClipboardEvent) {
  event.preventDefault()
  insert(event.clipboardData?.getData('text/plain') ?? '')
}
function copy(event: ClipboardEvent, cut = false) {
  const editor = element.value
  const range = editor && editorRange(editor)
  if (!range || range.collapsed || !event.clipboardData)
    return
  event.preventDefault()
  event.clipboardData.setData('text/plain', editorText(range.cloneContents(), true))
  if (cut) {
    range.deleteContents()
    input()
  }
}
function beforeInput(event: InputEvent) {
  if (composing || event.isComposing)
    return
  if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
    event.preventDefault()
    insert('\n')
  }
}
function click(event: MouseEvent) {
  const target = event.target as HTMLElement
  const pin = target.closest<HTMLElement>('[data-component-pin]')
  if (!pin) {
    emit('previewReference', null)
    return
  }
  if (!pin.matches(':disabled'))
    emit('previewReference', Number(pin.dataset.referenceStart))
}
function keydown(event: KeyboardEvent) {
  if (composing || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || !element.value)
    return
  const range = editorRange(element.value)
  if (!range?.collapsed || !['Backspace', 'Delete'].includes(event.key))
    return
  const cursor = editorCursor(element.value)
  const reference = props.references?.find(reference => reference.kind === 'component' && (event.key === 'Backspace' ? reference.end === cursor : reference.start === cursor))
  if (reference) {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('removeReference', reference.start)
    void nextTick(() => setCursor(reference.start))
  }
}
function compositionStart(event: CompositionEvent) {
  composing = true
  emit('compositionstart', event)
}
function compositionEnd(event: CompositionEvent) {
  composing = false
  input()
  emit('compositionend', event)
  void nextTick(sync)
}
onMounted(sync)
watch(() => [props.modelValue, props.command, props.references, props.invalidReferences], sync, { flush: 'post', deep: true })
defineExpose({ element, focus, getCursor: () => element.value ? editorCursor(element.value) : 0, setCursor })
</script>

<template>
  <div ref="element" class="acp-composer-editor" contenteditable="true" role="combobox" aria-label="Message" aria-multiline="true" :data-empty="!modelValue && !command ? 'true' : undefined" data-placeholder="Message your agent..." @click="click" @keydown="keydown" @blur="emit('previewReference', null)" @mouseleave="emit('previewReference', null)" @mousedown="($event.target as HTMLElement).closest('[data-component-pin]') && $event.preventDefault()" @input="input" @beforeinput="beforeInput" @paste="paste" @copy="copy" @cut="copy($event, true)" @drop.prevent @compositionstart="compositionStart" @compositionend="compositionEnd" />
</template>
