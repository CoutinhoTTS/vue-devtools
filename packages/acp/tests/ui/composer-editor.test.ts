import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { editorCursor, editorText, renderEditor, setEditorCursor } from '../../src/ui/composer-editor'
import ComposerEditor from '../../src/ui/ComposerEditor.vue'

const command = { id: 'codex:skill:review', name: 'review', kind: 'skill' as const }
const mounted: ReturnType<typeof mount>[] = []
function editor(text = '', pin = true) {
  const wrapper = mount(ComposerEditor, { attachTo: document.body, props: { modelValue: text, command: pin ? command : undefined } })
  mounted.push(wrapper)
  wrapper.element.focus()
  return wrapper
}
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  document.getSelection()?.removeAllRanges()
})

describe('contenteditable pin editor', () => {
  it('renders compact component pins with click-to-highlight and keyboard removal', async () => {
    const wrapper = editor('Check @<Home> next', false)
    await wrapper.setProps({ references: [{ kind: 'component', start: 6, end: 13, component: { name: 'Home', id: 'a:1', appId: 'a', scopeId: 'page', instanceToken: 'one', parentPath: 'Root' } }] })
    const pin = wrapper.get('[data-component-pin]')
    expect(pin.element.parentElement).toBe(wrapper.element)
    expect(pin.attributes('contenteditable')).toBe('false')
    expect(pin.element.tagName).toBe('BUTTON')
    expect(pin.attributes('aria-label')).toBe('Highlight Home')
    expect(pin.findAll('button, [data-remove-reference]')).toHaveLength(0)
    expect(pin.element.children).toHaveLength(2)
    expect(wrapper.text()).toBe('Check Home next')
    expect(editorText(wrapper.element)).toBe('Check @<Home> next')
    for (const offset of [0, 6, 13, 14, 18]) {
      setEditorCursor(wrapper.element, offset)
      expect(editorCursor(wrapper.element)).toBe(offset)
    }
    await pin.trigger('click')
    expect(wrapper.emitted('previewReference')?.at(-1)).toEqual([6])
    expect(wrapper.emitted('removeReference')).toBeUndefined()
    setEditorCursor(wrapper.element, 13)
    await wrapper.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('removeReference')?.at(-1)).toEqual([6])
    setEditorCursor(wrapper.element, 6)
    await wrapper.trigger('keydown', { key: 'Delete' })
    expect(wrapper.emitted('removeReference')).toHaveLength(2)
  })
  it('keeps unavailable component pins removable without allowing highlight', async () => {
    const wrapper = editor('@<Home>', false)
    await wrapper.setProps({ references: [{ kind: 'component', start: 0, end: 7, component: { name: 'Home', id: 'a:1', appId: 'a', scopeId: 'page', instanceToken: 'one', parentPath: 'Root' } }], invalidReferences: new Set(['one']) })
    const pin = wrapper.get('[data-component-pin]')
    expect(pin.attributes('disabled')).toBeDefined()
    await pin.trigger('click')
    expect(wrapper.emitted('previewReference')).toBeUndefined()
    setEditorCursor(wrapper.element, 7)
    await wrapper.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.emitted('removeReference')).toEqual([[0]])
  })
  it('renders an atomic inline node and places the caret immediately after it', () => {
    const wrapper = editor()
    expect(wrapper.element.tagName).toBe('DIV')
    expect(wrapper.attributes('contenteditable')).toBe('true')
    const pin = wrapper.find('[data-command-pin]')
    expect(pin.attributes('contenteditable')).toBe('false')
    expect(pin.element.parentElement).toBe(wrapper.element)
    setEditorCursor(wrapper.element, 0)
    expect(editorCursor(wrapper.element)).toBe(0)
    expect(pin.element.contains(document.getSelection()!.anchorNode)).toBe(false)
    expect(editorText(wrapper.element)).toBe('')
    expect(editorText(wrapper.element, true)).toBe('/review ')
  })
  it('round trips multiline text and caret offsets without counting the pin label', () => {
    const wrapper = editor('Hello\nworld')
    expect(editorText(wrapper.element)).toBe('Hello\nworld')
    for (let offset = 0; offset <= 11; offset++) {
      setEditorCursor(wrapper.element, offset)
      expect(editorCursor(wrapper.element)).toBe(offset)
    }
    renderEditor(wrapper.element, 'line\n', command)
    expect(editorText(wrapper.element)).toBe('line\n')
  })
  it('pastes only plain text, supports newlines, and never inserts clipboard HTML', async () => {
    const wrapper = editor('before ')
    setEditorCursor(wrapper.element, 7)
    await wrapper.trigger('paste', { clipboardData: { getData: (kind: string) => kind === 'text/plain' ? '<script>plain</script>\nnext' : '<img src=x onerror=alert(1)>' } })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['before <script>plain</script>\nnext'])
    expect(wrapper.find('[data-command-pin]').exists()).toBe(true)
  })
  it('copies and cuts the full selected command token along with its arguments', async () => {
    const wrapper = editor('target')
    const range = document.createRange()
    range.selectNodeContents(wrapper.element)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    let copied = ''
    await wrapper.trigger('cut', { clipboardData: { setData: (_type: string, value: string) => copied = value } })
    expect(copied).toBe('/review target')
    expect(wrapper.emitted('removeCommand')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })
  it('does not replace active IME nodes and commits the composed text once', async () => {
    const wrapper = editor('')
    await wrapper.trigger('compositionstart')
    const text = document.createTextNode('中文')
    wrapper.element.append(text)
    await wrapper.trigger('input')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({ modelValue: '中文' })
    expect(text.parentNode).toBe(wrapper.element)
    await wrapper.trigger('compositionend')
    await nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['中文'])
    expect(wrapper.find('[data-command-pin]').exists()).toBe(true)
  })
})
