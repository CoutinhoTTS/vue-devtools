import { VueSelect } from '@vue/devtools-ui'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AcpChat from '../../src/ui/AcpChat.vue'
import AgentIcon from '../../src/ui/AgentIcon.vue'
import ChatComposer from '../../src/ui/ChatComposer.vue'
import ChatMessages from '../../src/ui/ChatMessages.vue'
import ChatRequests from '../../src/ui/ChatRequests.vue'
import ChatSessionList from '../../src/ui/ChatSessionList.vue'
import { editorText, renderEditor, setEditorCursor } from '../../src/ui/composer-editor'
import { chatAgents, defaultSelection } from '../../src/ui/types'
import { fixtureSessions, providers } from './fixtures'

vi.mock('@vueuse/integrations/useFocusTrap', () => ({ useFocusTrap: () => ({ activate: vi.fn(), deactivate: vi.fn() }) }))
const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  mounted.splice(0).forEach(w => w.unmount())
  vi.unstubAllGlobals()
})
const stubs = {
  VueTooltip: { template: '<div><slot /></div>' },
  VueButton: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot name="icon"/><slot /></button>' },
  VueSelect: { props: ['modelValue', 'options', 'disabled'], emits: ['update:modelValue'], template: '<select :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in options" :value="item.value">{{ item.label }}</option></select>' },
  VueDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
}
function editor(wrapper: ReturnType<typeof mount>) {
  const result = wrapper.find('.acp-composer-editor') as DOMWrapper<HTMLDivElement>
  result.setValue = async (text: string) => {
    const pin = result.element.querySelector('[data-command-pin]')
    const command = pin ? { id: (pin as HTMLElement).dataset.commandId!, name: (pin as HTMLElement).dataset.commandName! } : undefined
    renderEditor(result.element, text, command)
    setEditorCursor(result.element, text.length)
    await result.trigger('input')
  }
  return result
}
function chat(props = {}, attachTo?: HTMLElement) {
  const wrapper = mount(AcpChat, { attachTo, props: { sessions: fixtureSessions(), selectedId: 'a', providers, connected: true, ...props }, global: { stubs } })
  mounted.push(wrapper)
  return wrapper
}
function composer(props = {}) {
  const wrapper = mount(ChatComposer, { props: { draft: '', selection: defaultSelection(), provider: providers[0], connected: true, running: false, agentLocked: false, ...props }, global: { stubs } })
  mounted.push(wrapper)
  return wrapper
}
describe('aCP chat UI', () => {
  it('inserts page-picked components as the same editable-draft pins used by mentions', async () => {
    const component = { name: 'Home', scopeId: 'page', appId: 'a', id: 'a:1', instanceToken: 'one', parentPath: 'Root' }
    const pick = vi.fn(async () => component)
    const wrapper = chat({ composerTransport: { commands: vi.fn(), files: vi.fn(), components: { pick, validate: async () => [true], highlight: async () => true } } })
    document.body.appendChild(wrapper.element)
    await editor(wrapper).setValue('Check this')
    setEditorCursor(editor(wrapper).element, 6)
    await wrapper.get('[aria-label="Select component in the page"]').trigger('click')
    await flushPromises()
    expect(pick).toHaveBeenCalledOnce()
    expect(editorText(editor(wrapper).element)).toBe('Check @<Home> this')
    expect(wrapper.get('[data-component-pin]').attributes('contenteditable')).toBe('false')
    expect(wrapper.findComponent(ChatComposer).props('references')).toMatchObject([{ kind: 'component', component, start: 6, end: 13 }])
    setEditorCursor(editor(wrapper).element, 13)
    await editor(wrapper).trigger('keydown', { key: 'Backspace' })
    expect(editorText(editor(wrapper).element)).toBe('Check  this')
    wrapper.element.remove()
  })
  it('cancels page selection on Escape and session changes and ignores late results', async () => {
    let resolve!: (value: any) => void
    const pick = vi.fn(() => new Promise<any>(done => resolve = done))
    const cancelPick = vi.fn(async () => {})
    const wrapper = chat({ composerTransport: { commands: vi.fn(), files: vi.fn(), components: { pick, cancelPick, validate: async () => [true], highlight: async () => true } } })
    await wrapper.get('[aria-label="Select component in the page"]').trigger('click')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(cancelPick).toHaveBeenCalledOnce()
    resolve({ name: 'Home' })
    await flushPromises()
    expect(wrapper.find('[data-component-pin]').exists()).toBe(false)
    await wrapper.get('[aria-label="Select component in the page"]').trigger('click')
    await flushPromises()
    await wrapper.setProps({ selectedId: 'b' })
    expect(cancelPick).toHaveBeenCalledTimes(2)
    resolve({ name: 'Home' })
    await flushPromises()
    expect(wrapper.find('[data-component-pin]').exists()).toBe(false)
  })
  it('handles picker cancellation, failures, unavailable transports and disconnected state', async () => {
    const pick = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Picker unavailable'))
    const wrapper = composer({ transport: { commands: vi.fn(), files: vi.fn(), components: { pick, validate: vi.fn(), highlight: vi.fn() } } })
    await wrapper.get('[aria-label="Select component in the page"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('completion')).toBeUndefined()
    await wrapper.get('[aria-label="Select component in the page"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Picker unavailable')
    await wrapper.setProps({ connected: false })
    expect(wrapper.get('[aria-label="Select component in the page"]').attributes('aria-disabled')).toBe('true')
    expect(composer().find('[aria-label="Select component in the page"]').exists()).toBe(false)
  })
  it('captures selected component state before sending and keeps the draft on capture failure', async () => {
    const snapshot = { page: 'http://localhost/', capturedAt: 1, component: { name: 'Home', id: 'a:1', parentPath: '' }, state: [{ group: 'setup', key: 'visible', value: true }], truncated: false, skipped: 0 }
    const capture = vi.fn(async () => [snapshot])
    const wrapper = chat({ composerTransport: { commands: async () => ({ status: 'ready', commands: [] }), files: async () => ({ files: [], truncated: false }), components: { capture, list: vi.fn(), validate: async () => [true], highlight: async () => true } } })
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: '@<Home> ', reference: { kind: 'component', component: { name: 'Home', scopeId: 'page', appId: 'a', id: 'a:1', instanceToken: 'one', parentPath: '' }, start: 0, end: 7 } })
    await flushPromises()
    expect(capture).not.toHaveBeenCalled()
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: '@<Home> ', references: [{ snapshot }] })
    capture.mockRejectedValueOnce(new Error('Component is no longer available'))
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('send')).toHaveLength(1)
    expect(wrapper.text()).toContain('Component is no longer available')
    expect(editorText(editor(wrapper).element)).toBe('@<Home> ')
  })
  it('blocks component context sending and restores sending after removal', async () => {
    const wrapper = chat({ composerTransport: { commands: async () => ({ status: 'ready', commands: [] }), files: async () => ({ files: [], truncated: false }), components: { list: vi.fn(), validate: async () => [true], highlight: async () => true } } }, document.body)
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: 'Check @<Home> ', reference: { kind: 'component', component: { name: 'Home', scopeId: 'page', appId: 'app', id: 'app:1', instanceToken: 'one', parentPath: 'Root' }, start: 6, end: 13 } })
    await flushPromises()
    expect(wrapper.findComponent(ChatComposer).props('references')).toHaveLength(1)
    expect(wrapper.find('.acp-send-button').attributes('aria-disabled')).not.toBe('true')
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    wrapper.findComponent(ChatComposer).vm.$emit('send')
    expect(wrapper.emitted('send')).toBeUndefined()
    setEditorCursor(editor(wrapper).element, 13)
    await editor(wrapper).trigger('keydown', { key: 'Backspace' })
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: 'Check  ' })
  })
  it('keeps desktop conversations visible without a sidebar toggle or header', async () => {
    const resize: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: HTMLElement) {
        if (target.classList.contains('acp-chat'))
          resize.push(() => this.callback([{ target, contentBoxSize: [{ inlineSize: 1000, blockSize: 800 }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver))
      }

      unobserve() {}
      disconnect() {}
    })
    const wrapper = chat()
    await nextTick()
    resize.forEach(callback => callback())
    await nextTick()
    expect(wrapper.find('header').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Toggle conversations"]').exists()).toBe(false)
    expect(wrapper.find('.acp-sidebar').exists()).toBe(true)
    expect(wrapper.findAll('.acp-session-item')).toHaveLength(2)
  })
  it('keeps the conversation drawer accessible on narrow screens without a header', async () => {
    const wrapper = chat()
    expect(wrapper.find('header').exists()).toBe(false)
    expect(wrapper.find('.acp-connection').exists()).toBe(false)
    const toggle = wrapper.get('.acp-bottom [aria-label="Toggle conversations"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.acp-session-item')).toHaveLength(2)
  })
  it('renders each conversation with its agent icon before the title and no agent name', async () => {
    const sessions = chatAgents.map((agent, index) => ({ ...fixtureSessions()[0], id: String(index), provider: agent.value, title: `Conversation ${index}`, status: 'idle' as const }))
    const wrapper = mount(ChatSessionList, { props: { sessions, selectedId: '0' }, global: { stubs } })
    mounted.push(wrapper)
    const items = wrapper.findAll('.acp-session-item')
    items.forEach((item, index) => {
      expect(item.text()).toBe(sessions[index].title)
      expect(item.findComponent(AgentIcon).props('provider')).toBe(sessions[index].provider)
      expect(item.element.firstElementChild).toBe(item.findComponent(AgentIcon).element)
    })
    expect(items[0].attributes('aria-current')).toBe('page')
    expect(items[1].attributes('aria-current')).toBeUndefined()
    await items[1].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['1']])
    await wrapper.setProps({ selectedId: '1', sessions: [{ ...sessions[1], title: '' }] })
    expect(wrapper.find('.acp-session-item').attributes('title')).toBe('Untitled conversation')
    expect(wrapper.find('.acp-session-item').classes()).toContain('selected')
  })
  it('keeps session items unfocusable while allowing selection without moving focus', async () => {
    const wrapper = mount(ChatSessionList, { props: { sessions: fixtureSessions(), selectedId: 'a' }, attachTo: document.body, global: { stubs } })
    mounted.push(wrapper)
    const newChat = wrapper.get<HTMLButtonElement>('[aria-label="New conversation"]')
    newChat.element.focus()
    const item = wrapper.get<HTMLElement>('.acp-session-item')
    expect(item.element.tabIndex).toBe(-1)
    item.element.focus()
    expect(document.activeElement).toBe(newChat.element)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    item.element.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await item.trigger('click')
    expect(document.activeElement).toBe(newChat.element)
    expect(wrapper.emitted('select')).toEqual([['a']])
  })
  it.each([['working', 'Running'], ['waiting', 'Waiting'], ['failed', 'Failed']] as const)('keeps %s status accessible without adding a second text line', (status, label) => {
    const session = { ...fixtureSessions()[0], status }
    const wrapper = mount(ChatSessionList, { props: { sessions: [session], selectedId: session.id }, global: { stubs } })
    mounted.push(wrapper)
    expect(wrapper.find('.acp-session-item').text()).toBe(session.title)
    expect(wrapper.find('.acp-session-status').attributes()).toMatchObject({ 'role': 'img', 'aria-label': label, 'title': label })
  })
  it('accepts slash completion before sending and respects IME and Escape', async () => {
    const wrapper = chat({ sessions: [], selectedId: null, composerTransport: { commands: async () => ({ status: 'ready', commands: [{ id: 'kimi:command:review', name: 'review', description: 'Review', kind: 'command', source: 'kimi', scope: 'builtin', execution: 'native' }] }), files: async () => ({ files: [], truncated: false }) } })
    let input = editor(wrapper)
    await input.trigger('focus')
    await input.setValue('/re')
    await input.trigger('keyup')
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')[0].text()).toContain('/review')
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.emitted('send')).toBeUndefined()
    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    input = editor(wrapper)
    expect(editorText(input.element)).toBe('')
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').text()).toBe('review')
    expect(wrapper.emitted('send')).toBeUndefined()
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ command: { id: 'kimi:command:review', name: 'review' } })
    await input.setValue('/')
    await input.trigger('keyup')
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
  it('keeps a removable command pin independent of the argument draft', async () => {
    const wrapper = chat()
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: '/review inspect @src ', command: { id: 'kimi:command:review', name: 'review', kind: 'command' } })
    await nextTick()
    expect(editorText(editor(wrapper).element)).toBe('inspect @src ')
    await wrapper.setProps({ selectedId: 'b' })
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').exists()).toBe(false)
    await wrapper.setProps({ selectedId: 'a' })
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').text()).toBe('review')
    expect(editorText(editor(wrapper).element)).toBe('inspect @src ')
    wrapper.find('.acp-composer-editor [data-command-pin]').element.remove()
    await editor(wrapper).trigger('input')
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').exists()).toBe(false)
    expect(editorText(editor(wrapper).element)).toBe('inspect @src ')
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: 'inspect @src ' })
    expect(wrapper.emitted('send')?.[0]?.[0]).not.toHaveProperty('command')
  })
  it('requires two empty delete presses, ignores repeats and composes full submissions', async () => {
    const wrapper = chat()
    const command = { id: 'kimi:skill:review', name: 'review', kind: 'skill' as const }
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: '/review ', command })
    await nextTick()
    const input = editor(wrapper)
    await input.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.find('.acp-command-pin').classes()).toContain('armed')
    await input.trigger('keydown', { key: 'Backspace', repeat: true })
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').exists()).toBe(true)
    await input.trigger('keydown', { key: 'Backspace' })
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').exists()).toBe(false)
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: '/review ', command })
    await nextTick()
    wrapper.findComponent(ChatComposer).vm.$emit('completion', { text: 'Read @file.ts', reference: { path: 'file.ts', start: 5, end: 13 } })
    await nextTick()
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ content: '/review Read @file.ts', command, references: [{ path: 'file.ts', start: 13, end: 21 }] })
    await wrapper.setProps({ accepted: { key: 'a', content: '/review Read @file.ts', sequence: 1 } })
    expect(editorText(editor(wrapper).element)).toBe('')
    expect(wrapper.find('.acp-composer-editor [data-command-pin]').exists()).toBe(false)
  })
  it('renders command pins in stored and legacy messages while copying original text', async () => {
    const sessions = fixtureSessions()
    sessions[0].messages = [
      { id: 'one', turnId: 'one', role: 'user', createdAt: 1, content: [{ type: 'text', text: '/review target' }], command: { id: 'kimi:skill:review', name: 'review', kind: 'skill' } },
      { id: 'two', turnId: 'two', role: 'user', createdAt: 2, content: [{ type: 'text', text: '/4.0-app-router' }] },
      { id: 'three', turnId: 'three', role: 'user', createdAt: 3, content: [{ type: 'text', text: '/src/file.ts' }] },
    ]
    const wrapper = chat({ sessions })
    expect(wrapper.findAll('.acp-user-text .acp-command-pin').map(pin => pin.text())).toEqual(['review', '4.0-app-router'])
    expect(wrapper.findAll('.acp-user-body').map(body => body.text())).toEqual(['target', '/src/file.ts'])
    expect(wrapper.find('.acp-user-text .acp-pin-remove').exists()).toBe(false)
    await wrapper.find('[aria-label="Copy message"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/review target')
  })
  it('inserts quoted references and removes their metadata when edited', async () => {
    const wrapper = chat({ composerTransport: { commands: async () => ({ status: 'ready', commands: [] }), files: async () => ({ files: [{ path: 'src/a b.ts', isDirectory: false }], truncated: false }) } })
    const input = editor(wrapper)
    await input.trigger('focus')
    await input.setValue('Read @src')
    await input.trigger('keyup')
    await vi.waitFor(() => expect(wrapper.findAll('[role="option"]')).toHaveLength(1))
    await input.trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(editorText(input.element)).toBe('Read @"src/a b.ts" ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.[0]).toMatchObject({ references: [{ path: 'src/a b.ts', start: 5, end: 18 }] })
    await input.setValue('Read something else')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[1]?.[0]).not.toHaveProperty('references')
  })
  it('runs /new locally while another turn is active and preserves its draft', async () => {
    const sessions = fixtureSessions()
    sessions[0].status = 'working'
    const wrapper = chat({ sessions })
    await editor(wrapper).setValue('/new')
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('newChat')).toHaveLength(1)
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.emitted('stop')).toBeUndefined()
    await wrapper.setProps({ selectedId: null })
    await wrapper.setProps({ selectedId: 'a' })
    expect(editorText(editor(wrapper).element)).toBe('/new')
  })
  it('formats thinking labels without changing the submitted value', async () => {
    const selection = { ...defaultSelection(), options: { ...defaultSelection().options, reasoningEffort: 'xhigh' } }
    const wrapper = composer({ selection })
    expect(wrapper.find('[aria-label="Thinking level"]').text()).toBe('Max')
    wrapper.findAllComponents(VueSelect)[2].vm.$emit('update:modelValue', 'high')
    expect(wrapper.emitted('selection')?.[0]?.[0]).toMatchObject({ options: { reasoningEffort: 'high' } })
    await wrapper.setProps({ selection: { ...selection, options: { ...selection.options, reasoningEffort: 'custom-effort' } } })
    expect(wrapper.find('[aria-label="Thinking level"]').text()).toBe('custom-effort')
    await wrapper.setProps({ selection: defaultSelection() })
    expect(wrapper.find('.acp-thinking-control').attributes('data-effort')).toBe('default')
  })
  it('keeps model refresh inside the composer and preserves the selected agent and pending guard', async () => {
    const wrapper = chat()
    const refresh = wrapper.find('.acp-input-frame [aria-label="Refresh agent models"]')
    await refresh.trigger('click')
    expect(wrapper.emitted('refreshAgent')?.[0]).toEqual(['kimi'])
    await wrapper.setProps({ providers: providers.map(provider => ({ ...provider, refreshing: true })) })
    const loading = wrapper.find('.acp-input-frame [aria-label="Loading models..."]')
    expect(loading.attributes('aria-disabled')).toBe('true')
    await loading.trigger('click')
    expect(wrapper.emitted('refreshAgent')).toHaveLength(1)
  })
  it('grows multiline drafts to 240px and shrinks cleared drafts to one line', async () => {
    const wrapper = composer()
    await nextTick()
    const textarea = editor(wrapper).element
    expect(textarea.style.height).toBe('24px')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 48 })
    await wrapper.setProps({ draft: 'first line\nsecond line' })
    await nextTick()
    expect(textarea.style.height).toBe('48px')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 500 })
    await wrapper.setProps({ draft: 'line\n'.repeat(30) })
    await nextTick()
    expect(textarea.style.height).toBe('240px')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 24 })
    await wrapper.setProps({ draft: '' })
    await nextTick()
    expect(textarea.style.height).toBe('24px')
  })
  it('renders a local theme-aware icon for every supported agent', () => {
    for (const agent of chatAgents) {
      const wrapper = mount(AgentIcon, { props: { provider: agent.value } })
      mounted.push(wrapper)
      expect(wrapper.attributes('aria-hidden')).toBe('true')
      if (agent.value === 'claude' || agent.value === 'openCode') {
        expect(wrapper.element.tagName).toBe('IMG')
        expect(wrapper.attributes('src')).toContain('data:image/svg+xml,')
        const svg = decodeURIComponent(wrapper.attributes('src'))
        expect(svg).toContain(agent.value === 'claude' ? '#ff7043' : '#607d8b')
        if (agent.value === 'openCode')
          expect(svg).toContain('#cfd8dc')
        expect(wrapper.attributes('style')).toBeUndefined()
      }
      else {
        expect(wrapper.attributes('style')).toContain('mask-image: url("')
        expect(wrapper.attributes('style')).toContain('data:image/svg+xml,')
        expect(wrapper.attributes('style')).toContain('background-color: currentcolor')
      }
      expect(wrapper.classes()).not.toContain('i-carbon-bot')
    }
  })
  it('keeps all configuration controls inside the composer frame', () => {
    const wrapper = composer()
    expect(wrapper.find('.acp-input-frame').findAllComponents(VueSelect)).toHaveLength(3)
    expect(wrapper.find('.acp-control-label').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Agent"]').findComponent(AgentIcon).props('provider')).toBe('kimi')
  })
  it.each([
    { running: true },
    { optionsPending: true },
    { connected: false },
  ])('omits the composer status line for %j', (props) => {
    const wrapper = composer(props)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Working\.\.\.|Applying configuration\.\.\.|Not connected/)
  })
  it('omits visible role headings while retaining accessible message labels', () => {
    const wrapper = chat()
    expect(wrapper.find('.acp-message-author').exists()).toBe(false)
    expect(wrapper.find('article.user').attributes('aria-label')).toBe('You')
    expect(wrapper.find('article.assistant').attributes('aria-label')).toBe('Assistant')
  })
  it('remembers each agent model without enabling chat submission', async () => {
    const wrapper = chat({ sessions: [], selectedId: null, connected: false, catalogReady: true })
    wrapper.findAllComponents(VueSelect)[1].vm.$emit('update:modelValue', 'model-b')
    await nextTick()
    wrapper.findAllComponents(VueSelect)[0].vm.$emit('update:modelValue', 'pi')
    await nextTick()
    expect(wrapper.emitted('agentSelected')?.[0]).toEqual(['pi'])
    wrapper.findAllComponents(VueSelect)[0].vm.$emit('update:modelValue', 'kimi')
    await nextTick()
    expect(wrapper.findComponent(ChatComposer).props('selection').options.model).toBe('model-b')
    await editor(wrapper).setValue('hello')
    expect(wrapper.find('[aria-label="Send message"]').attributes('aria-disabled')).toBe('true')
  })
  it('keeps drafts and agent settings isolated while switching running sessions', async () => {
    const wrapper = chat()
    await editor(wrapper).setValue('draft A')
    await wrapper.find('[aria-label="Toggle conversations"]').trigger('click')
    await nextTick()
    const items = wrapper.findAll('.acp-session-item')
    expect(items).toHaveLength(2)
    expect(items[1].attributes('title')).toContain('very long')
    await items[1].trigger('click')
    expect(editorText(editor(wrapper).element)).toBe('')
    expect(wrapper.findComponent(ChatComposer).props('selection').provider).toBe('pi')
    await editor(wrapper).setValue('draft B')
    await wrapper.find('[aria-label="Toggle conversations"]').trigger('click')
    await wrapper.findAll('.acp-session-item')[0].trigger('click')
    expect(editorText(editor(wrapper).element)).toBe('draft A')
    expect(wrapper.emitted('stop')).toBeUndefined()
    expect(wrapper.findComponent(ChatComposer).props('agentLocked')).toBe(true)
  })
  it('opens a new draft without cancelling the active conversation', async () => {
    const wrapper = chat({ selectedId: 'b' })
    await wrapper.find('[aria-label="Toggle conversations"]').trigger('click')
    await wrapper.find('[aria-label="New conversation"]').trigger('click')
    expect(wrapper.emitted('newChat')).toHaveLength(1)
    expect(wrapper.emitted('stop')).toBeUndefined()
    expect(wrapper.findComponent(ChatComposer).props('agentLocked')).toBe(false)
  })
  it('keeps existing options controlled until the parent confirms them', async () => {
    const wrapper = chat()
    wrapper.findAllComponents(VueSelect)[1].vm.$emit('update:modelValue', 'model-b')
    await nextTick()
    expect(wrapper.emitted('changeOptions')?.[0]?.[0]).toMatchObject({ sessionId: 'a', options: { model: 'model-b', reasoningEffort: null } })
    expect(wrapper.findComponent(ChatComposer).props('selection').options.model).toBe('model-a')
  })
  it('shows a disconnected empty page without fake messages', async () => {
    const wrapper = chat({ sessions: [], selectedId: null, connected: false })
    await editor(wrapper).setValue('editable draft')
    await editor(wrapper).trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toBeUndefined()
    expect(wrapper.findAll('.acp-message')).toHaveLength(0)
    expect(wrapper.find('[aria-label="Send message"]').attributes('aria-disabled')).toBe('true')
  })
  it('handles IME, Shift+Enter, blank messages and send/stop', async () => {
    const wrapper = composer({ draft: 'hello' })
    const input = editor(wrapper)
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toBeUndefined()
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toHaveLength(1)
    await wrapper.setProps({ running: true })
    await wrapper.find('[aria-label="Stop response"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
    await wrapper.setProps({ running: false, draft: ' ' })
    expect(wrapper.find('[aria-label="Send message"]').attributes('aria-disabled')).toBe('true')
  })
  it('limits thinking options by model and disables unsupported controls', async () => {
    const wrapper = composer({ selection: { provider: 'kimi', options: { mode: 'ask', model: 'model-a', reasoningEffort: 'high' } } })
    wrapper.findAllComponents(VueSelect)[1].vm.$emit('update:modelValue', 'model-b')
    await nextTick()
    expect(wrapper.emitted('selection')?.[0]?.[0]).toMatchObject({ options: { model: 'model-b', reasoningEffort: null } })
    await wrapper.setProps({ provider: providers[1] })
    expect(wrapper.findAllComponents(VueSelect)[2].props('disabled')).toBe(true)
  })
  it('renders streaming Markdown in place and blocks raw HTML and unsafe links', async () => {
    const message = fixtureSessions()[0].messages[1]
    message.streaming = true
    message.content = [{ type: 'text', text: '**Hello**\n\n<script>alert(1)</script>\n[bad](javascript:alert(1))' }]
    const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: [message], tools: [], running: true }, global: { stubs } })
    mounted.push(wrapper)
    await nextTick()
    const article = wrapper.find('article').element
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
    await wrapper.setProps({ messages: [{ ...message, streaming: false, content: [{ type: 'text', text: '**Hello world**' }] }], running: false })
    expect(wrapper.find('article').element).toBe(article)
    await wrapper.find('[aria-label="Copy message"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('**Hello world**')
  })
  it('submits permissions and questions with separate pending/error states', async () => {
    const wrapper = mount(ChatRequests, { props: { connected: true, permission: { id: 'p', title: 'Run command', detail: 'npm test', options: [{ id: 'allow', label: 'Allow once', kind: 'allowOnce' }] } }, global: { stubs } })
    mounted.push(wrapper)
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('permission')?.[0]?.[0]).toEqual({ requestId: 'p', outcome: 'selected', optionId: 'allow' })
    await wrapper.setProps({ permission: undefined, question: { id: 'q', questions: [{ id: '1', prompt: 'Select a mode', options: [{ id: 'a', label: 'A' }], multiple: false, allowText: false }] } })
    await wrapper.find('input').setValue(true)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('answer')?.[0]?.[0]).toMatchObject({ requestId: 'q', outcome: 'answered' })
    await wrapper.setProps({ pending: true, error: 'Please retry' })
    expect(wrapper.text()).toContain('Submitting')
    expect(wrapper.find('[role="alert"]').text()).toBe('Please retry')
  })
  it('does not force scroll while reading history and resets following per session', async () => {
    const message = fixtureSessions()[0].messages[1]
    const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: [message], tools: [], running: true }, global: { stubs } })
    mounted.push(wrapper)
    const viewport = wrapper.find('.acp-messages-scroll')
    Object.defineProperties(viewport.element, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 300 } })
    viewport.element.scrollTop = 100
    await viewport.trigger('scroll')
    await wrapper.setProps({ messages: [{ ...message, content: [{ type: 'text', text: 'New chunk' }] }] })
    expect(viewport.element.scrollTop).toBe(100)
    expect(wrapper.find('[aria-label="Scroll to bottom"]').exists()).toBe(true)
    await wrapper.setProps({ sessionKey: 'b' })
    await nextTick()
    expect(viewport.element.scrollTop).toBe(1200)
    expect(wrapper.find('[aria-label="Scroll to bottom"]').exists()).toBe(false)
  })
  it('follows composer resizing only when already at the bottom', async () => {
    const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: fixtureSessions()[0].messages, running: false, bottomInset: 114 }, global: { stubs } })
    mounted.push(wrapper)
    await nextTick()
    const viewport = wrapper.get('.acp-messages-scroll')
    Object.defineProperties(viewport.element, { scrollHeight: { configurable: true, value: 1200 }, clientHeight: { configurable: true, value: 300 } })
    await wrapper.setProps({ bottomInset: 298 })
    await nextTick()
    expect(viewport.element.scrollTop).toBe(1200)
    viewport.element.scrollTop = 100
    await viewport.trigger('scroll')
    await wrapper.setProps({ bottomInset: 114 })
    await nextTick()
    expect(viewport.element.scrollTop).toBe(100)
  })
  it('shows tool details and errors as text without executing embedded markup', async () => {
    const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: [{ id: 'tool-message', turnId: 'turn', role: 'assistant', content: [], createdAt: 1, parts: [{ type: 'tool', tool: { id: 'tool', title: 'Read state', status: 'failed', output: '<img src=x onerror=alert(1)>' } }] }], running: false, error: 'Disconnected' }, global: { stubs } })
    mounted.push(wrapper)
    expect(wrapper.find('details').exists()).toBe(true)
    expect(wrapper.find('pre').text()).toContain('<img')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').text()).toBe('Disconnected')
  })
  it('renders tool blocks in their owning message without moving or duplicating them on completion', async () => {
    const first = { id: 'a1', turnId: 't1', role: 'assistant' as const, createdAt: 1, content: [{ type: 'text' as const, text: 'Before execution. After execution.' }], streaming: true, parts: [
      { type: 'text' as const, text: 'Before execution.' },
      { type: 'tool' as const, tool: { id: 'tool-1', messageId: 'a1', turnId: 't1', title: 'Read App.vue', status: 'running' as const } },
      { type: 'text' as const, text: 'After execution.' },
    ] }
    const second = { id: 'a2', turnId: 't2', role: 'assistant' as const, createdAt: 2, content: [{ type: 'text' as const, text: 'Next message.' }] }
    const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: [first, second], running: true }, global: { stubs } })
    mounted.push(wrapper)
    const owner = wrapper.find('[data-message-id="a1"]')
    const tool = owner.find('details')
    expect(wrapper.find('[data-message-id="a2"] .acp-tools').exists()).toBe(false)
    expect(wrapper.find('.acp-messages-content > .acp-tools').exists()).toBe(false)
    expect(Array.from(owner.element.children).slice(0, 3).map(child => child.textContent)).toEqual(['Before execution.', expect.stringContaining('执行过程'), 'After execution.'])
    expect(tool.find('summary').text()).not.toContain('Read App.vue')
    tool.element.setAttribute('open', '')
    await wrapper.setProps({ messages: [{ ...first, streaming: false, parts: first.parts.map(part => part.type === 'tool' ? { ...part, tool: { ...part.tool, status: 'completed' as const } } : part) }, second] })
    expect(wrapper.find('[data-message-id="a1"] details').element).toBe(tool.element)
    expect(tool.attributes('open')).toBe('')
    expect(tool.attributes('data-status')).toBe('completed')
    expect(wrapper.findAll('details')).toHaveLength(1)
    await owner.find('[aria-label="Copy message"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Before execution. After execution.')
  })
})
