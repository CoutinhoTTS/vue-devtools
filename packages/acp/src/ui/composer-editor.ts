import type { ComposerComponentReference, ComposerReference, ComposerSelection } from '../schema'
import { referenceMention } from './composer-completion'

export interface ComposerEditorHandle {
  element?: HTMLDivElement
  focus: () => void
  getCursor: () => number
  setCursor: (offset: number) => void
}

interface Point { node: Node, offset: number }
interface Segment { text: string, start: Point, end: Point, textOffset?: number }
export const pinSelector = '[data-command-pin="true"]'

function after(node: Node): Point {
  const parent = node.parentNode!
  return { node: parent, offset: Array.from(parent.childNodes).indexOf(node as ChildNode) + 1 }
}

function segments(root: Node, includeCommand = false): Segment[] {
  const result: Segment[] = []
  const lineBreak = (start: Point, end: Point) => result.push({ text: '\n', start, end })
  const visit = (node: Node) => {
    if (node instanceof HTMLElement && node.dataset.componentPin === 'true') {
      result.push({ text: node.dataset.referenceText ?? '', start: { node: node.parentNode!, offset: after(node).offset - 1 }, end: after(node) })
      return
    }
    if (node instanceof HTMLElement && node.matches(pinSelector)) {
      if (includeCommand)
        result.push({ text: `/${node.dataset.commandName} `, start: { node: node.parentNode!, offset: after(node).offset - 1 }, end: after(node) })
      return
    }
    if (node instanceof HTMLElement && node.dataset.editorTrailing === 'true')
      return
    if (node.nodeType === Node.TEXT_NODE) {
      result.push({ text: node.textContent ?? '', start: { node, offset: 0 }, end: { node, offset: node.textContent?.length ?? 0 }, textOffset: 0 })
      return
    }
    if (node instanceof HTMLBRElement) {
      lineBreak({ node: node.parentNode!, offset: after(node).offset - 1 }, after(node))
      return
    }
    const block = node instanceof HTMLElement && ['DIV', 'P'].includes(node.tagName)
    if (block && node.previousSibling && result.length && !result[result.length - 1].text.endsWith('\n'))
      lineBreak({ node: node.parentNode!, offset: after(node).offset - 1 }, { node, offset: 0 })
    for (const child of Array.from(node.childNodes))
      visit(child)
    if (block && node.nextSibling && !(node.nextSibling instanceof HTMLElement && ['DIV', 'P'].includes(node.nextSibling.tagName)) && !result[result.length - 1]?.text.endsWith('\n'))
      lineBreak({ node, offset: node.childNodes.length }, after(node))
  }
  for (const node of Array.from(root.childNodes))
    visit(node)
  return result
}

export function editorText(root: Node, includeCommand = false) {
  return segments(root, includeCommand).map(segment => segment.text).join('')
}

export function editorRange(editor: HTMLElement): Range | undefined {
  const selection = editor.ownerDocument.getSelection()
  if (!selection?.rangeCount)
    return
  const range = selection.getRangeAt(0)
  return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : undefined
}

export function editorCursor(editor: HTMLElement) {
  const range = editorRange(editor)
  if (!range)
    return editorText(editor).length
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.endContainer, range.endOffset)
  return editorText(before.cloneContents()).length
}

export function setEditorCursor(editor: HTMLElement, offset: number) {
  let remaining = Math.max(0, offset)
  const pin = editor.querySelector(pinSelector)
  let point: Point = pin ? after(pin) : { node: editor, offset: 0 }
  for (const segment of segments(editor)) {
    if (remaining <= segment.text.length) {
      point = segment.textOffset !== undefined ? { node: segment.start.node, offset: remaining } : remaining ? segment.end : segment.start
      break
    }
    remaining -= segment.text.length
    point = segment.end
  }
  const range = editor.ownerDocument.createRange()
  range.setStart(point.node, point.offset)
  range.collapse(true)
  const selection = editor.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** The pin is an atomic inline node inside the same editable div as the text. */
export function createCommandPin(command: ComposerSelection, doc = document) {
  const pin = doc.createElement('span')
  pin.className = 'acp-command-pin'
  pin.setAttribute('contenteditable', 'false')
  pin.dataset.commandPin = 'true'
  pin.dataset.commandId = command.id
  pin.dataset.commandName = command.name
  pin.title = `/${command.name}`
  const icon = doc.createElement('span')
  icon.className = 'i-lucide-pin acp-pin-icon'
  icon.setAttribute('aria-hidden', 'true')
  const label = doc.createElement('span')
  label.className = 'acp-pin-label'
  label.textContent = command.name
  pin.append(icon, label)
  return pin
}

export function plainTextFragment(text: string, doc = document) {
  const fragment = doc.createDocumentFragment()
  text.split('\n').forEach((line, index) => {
    if (index)
      fragment.append(doc.createElement('br'))
    fragment.append(doc.createTextNode(line))
  })
  return fragment
}

export function createComponentPin(reference: ComposerComponentReference, invalid: boolean, doc = document) {
  const pin = doc.createElement('button')
  pin.type = 'button'
  pin.tabIndex = -1
  pin.disabled = invalid
  pin.className = `acp-command-pin acp-component-pin${invalid ? ' invalid' : ''}`
  pin.setAttribute('contenteditable', 'false')
  pin.setAttribute('aria-label', `Highlight ${reference.component.name}`)
  pin.dataset.componentPin = 'true'
  pin.dataset.referenceStart = String(reference.start)
  pin.dataset.referenceText = referenceMention(reference)
  pin.dataset.instanceToken = reference.component.instanceToken
  pin.title = `${reference.component.parentPath} / ${reference.component.name} (${reference.component.id})${invalid ? ' - Unavailable' : ''}`
  const icon = doc.createElement('span')
  icon.className = 'i-lucide-box acp-pin-icon'
  icon.setAttribute('aria-hidden', 'true')
  const label = doc.createElement('span')
  label.className = 'acp-pin-label'
  label.textContent = reference.component.name
  pin.append(icon, label)
  return pin
}

export function renderEditor(editor: HTMLElement, text: string, command?: ComposerSelection, references: ComposerReference[] = [], invalid = new Set<string>()) {
  const fragment = editor.ownerDocument.createDocumentFragment()
  let offset = 0
  for (const reference of [...references].sort((a, b) => a.start - b.start)) {
    if (reference.kind !== 'component' || reference.start < offset || text.slice(reference.start, reference.end) !== referenceMention(reference))
      continue
    fragment.append(plainTextFragment(text.slice(offset, reference.start), editor.ownerDocument))
    fragment.append(createComponentPin(reference, invalid.has(reference.component.instanceToken), editor.ownerDocument))
    offset = reference.end
  }
  fragment.append(plainTextFragment(text.slice(offset), editor.ownerDocument))
  if (command)
    fragment.prepend(createCommandPin(command, editor.ownerDocument))
  if (!text || text.endsWith('\n')) {
    const trailing = editor.ownerDocument.createElement('br')
    trailing.dataset.editorTrailing = 'true'
    fragment.append(trailing)
  }
  editor.replaceChildren(fragment)
}
