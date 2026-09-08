import type { ChatMessage } from '../../src/ui/types'
import { VueCodeBlock } from '@vue/devtools-ui'
import { mount } from '@vue/test-utils'
import MarkdownRender, { getCustomNodeComponents } from 'markstream-vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatCodeBlock from '../../src/ui/ChatCodeBlock.vue'
import ChatMessages from '../../src/ui/ChatMessages.vue'

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.unstubAllGlobals()
})
function message(text: string, streaming = false): ChatMessage {
  return { id: 'code', turnId: 'turn', role: 'assistant', createdAt: 1, streaming, content: [{ type: 'text', text }] }
}
function chat(text: string, streaming = false) {
  const wrapper = mount(ChatMessages, { props: { sessionKey: 'a', messages: [message(text, streaming)], running: streaming } })
  mounted.push(wrapper)
  return wrapper
}

describe('chat code highlighting', () => {
  it('renders JSON with the shared Shiki component and both theme colors', async () => {
    const code = '{\n  "rowKey": "id",\n  "stripe": true,\n  "indent": 16\n}'
    const markdown = ['Table props:', '', '```json', code, '```'].join('\n')
    const wrapper = chat(markdown)
    await vi.waitFor(() => expect(wrapper.find('.shiki span[style]').exists()).toBe(true))
    expect(wrapper.get('.shiki code').element.textContent).toBe(`${code}\n`)
    expect(wrapper.getComponent(VueCodeBlock).props('lines')).toBe(false)
    const colors = wrapper.findAll('.shiki span[style]').map(token => token.attributes('style'))
    expect(new Set(colors).size).toBeGreaterThan(2)
    expect(colors.every(style => style.includes('--shiki-dark:'))).toBe(true)
    await wrapper.setProps({ isDark: true })
    expect(wrapper.get('.acp-code-block').attributes('data-theme')).toBe('dark')
    await wrapper.get('[aria-label="Copy message"]').trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(markdown)
  })

  it.each([['JSON', '{"ok": true}'], ['js', 'const value = true'], ['ts', 'const value: number = 16'], ['vue', '<template><div>Hello</div></template>']])('highlights %s fences', async (language, code) => {
    const wrapper = chat([`\`\`\`${language}`, code, '```'].join('\n'))
    await vi.waitFor(() => expect(wrapper.find('.shiki span[style]').exists()).toBe(true))
    expect(wrapper.get('.shiki code').element.textContent).toBe(`${code}\n`)
  })

  it('updates incomplete streamed code and keeps highlighting after completion', async () => {
    const wrapper = chat('```json\n{"stripe":', true)
    await vi.waitFor(() => expect(wrapper.find('.shiki span[style]').exists()).toBe(true))
    const text = '```json\n{"stripe": true, "indent": 16}\n```'
    await wrapper.setProps({ messages: [message(text, true)] })
    await vi.waitFor(() => expect(wrapper.get('.shiki code').text()).toBe('{"stripe": true, "indent": 16}'), { timeout: 3000 })
    await wrapper.setProps({ messages: [message(text)], running: false })
    expect(wrapper.find('.shiki span[style]').exists()).toBe(true)
    expect(wrapper.findAllComponents(ChatCodeBlock)).toHaveLength(1)
  })

  it.each(['', 'text', 'unknown-language', 'html'])('escapes markup in %s fences without executing it', async (language) => {
    const code = '<img src=x onerror=alert(1)>'
    const wrapper = chat([`\`\`\`${language}`, code, '```'].join('\n'))
    await vi.waitFor(() => expect(wrapper.find('.acp-code-block').exists()).toBe(true))
    if (language === 'html')
      await vi.waitFor(() => expect(wrapper.find('.shiki span[style]').exists()).toBe(true))
    else
      expect(wrapper.find('.shiki span[style]').exists()).toBe(false)
    expect(wrapper.get('.shiki code').text()).toBe(code)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('scopes the renderer to chat, handles nested fences, and removes it on unmount', async () => {
    const wrapper = chat('> ```json\n> {"ok": true}\n> ```')
    await vi.waitFor(() => expect(wrapper.find('blockquote .shiki span[style]').exists()).toBe(true))
    const id = wrapper.getComponent(MarkdownRender).props('customId')!
    expect(getCustomNodeComponents(id).code_block).toBe(ChatCodeBlock)
    expect(getCustomNodeComponents().code_block).toBeUndefined()
    wrapper.unmount()
    mounted.pop()
    expect(getCustomNodeComponents(id).code_block).toBeUndefined()
  })
})
