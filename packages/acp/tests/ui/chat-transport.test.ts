import type { AgentChatTransport } from '@vue/devtools-acp'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { defaultSelection } from '../../src/ui/types'
import { useAgentChat } from '../../src/ui/useAgentChat'

describe('chat transport', () => {
  it('retains drafts when runtime initialization fails after RPC acceptance', async () => {
    let snapshot: any[] = []
    const transport: AgentChatTransport = { list: async () => snapshot, send: async (input) => {
      snapshot = [{ id: 's1', title: input.content, provider: input.provider, options: input.options, status: 'failed', messages: [], tools: [], error: 'Agent unavailable' }]
      return { sessionId: 's1' }
    }, stop: vi.fn(), permission: vi.fn(), answer: vi.fn(), options: vi.fn() }
    let chat!: ReturnType<typeof useAgentChat>
    const wrapper = mount(defineComponent({ setup() {
      chat = useAgentChat(transport)
      return () => h('div')
    } }))
    try {
      await chat.start()
      await chat.send({ ...defaultSelection(), sessionId: null, content: '/review' })
      expect(chat.accepted.value).toBeUndefined()
      expect(chat.sessions.value[0].messages[0].delivery).toBe('failed')
      expect(chat.selectedId.value).toBeNull()
    }
    finally { wrapper.unmount() }
  })
  it('deduplicates confirmation and preserves failed optimistic messages across polls', async () => {
    let snapshot: any[] = []
    let fail = false
    const transport: AgentChatTransport = {
      list: async () => structuredClone(snapshot),
      send: async (input) => {
        if (fail)
          throw new Error('offline')
        snapshot = [{ id: 's1', title: 'hello', provider: input.provider, options: input.options, status: 'idle', tools: [], messages: [{ id: input.requestId, turnId: 't1', role: 'user', createdAt: 1, content: [{ type: 'text', text: input.content }] }] }]
        return { sessionId: 's1' }
      },
      stop: vi.fn(),
      permission: vi.fn(),
      answer: vi.fn(),
      options: vi.fn(),
    }
    let chat!: ReturnType<typeof useAgentChat>
    const wrapper = mount(defineComponent({ setup() {
      chat = useAgentChat(transport)
      return () => h('div')
    } }))
    try {
      await chat.start()
      await chat.send({ ...defaultSelection(), sessionId: null, content: 'hello' })
      expect(chat.sessions.value).toHaveLength(1)
      expect(chat.sessions.value[0].messages).toHaveLength(1)
      expect(chat.sessions.value[0].messages[0].delivery).toBeUndefined()
      fail = true
      await chat.send({ ...defaultSelection(), sessionId: 's1', content: 'second' })
      expect(chat.sessions.value[0].messages[1].delivery).toBe('failed')
      await chat.start()
      expect(chat.sessions.value[0].messages).toHaveLength(2)
      expect(chat.sessions.value[0].messages[1].delivery).toBe('failed')
    }
    finally { wrapper.unmount() }
  })
  it('uses chosen provider and options, acknowledges drafts and prevents double sends', async () => {
    let finish!: (value: { sessionId: string }) => void
    const send = vi.fn(() => new Promise<{ sessionId: string }>(resolve => finish = resolve))
    let snapshot: any[] = []
    const transport: AgentChatTransport = { list: async () => snapshot, send, stop: vi.fn(), permission: vi.fn(), answer: vi.fn(), options: vi.fn() }
    let chat!: ReturnType<typeof useAgentChat>
    const wrapper = mount(defineComponent({ setup() {
      chat = useAgentChat(transport)
      return () => h('div')
    } }))
    try {
      await chat.start()
      const value = { ...defaultSelection(), sessionId: null, content: 'hello' }
      const pending = chat.send(value)
      expect(chat.sessions.value[0].messages[0]).toMatchObject({ role: 'user', delivery: 'sending', content: [{ type: 'text', text: 'hello' }] })
      expect(chat.selectedId.value).toMatch(/^pending:/)
      expect(chat.accepted.value).toBeUndefined()
      await chat.send(value)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][0]).toMatchObject({ provider: 'kimi', content: 'hello' })
      finish({ sessionId: 's1' })
      const request = send.mock.calls[0][0]
      snapshot = [{ id: 's1', provider: 'kimi', options: value.options, status: 'working', title: 'hello', tools: [], messages: [{ id: request.requestId, turnId: 't1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'hello' }] }] }]
      await pending
      expect(chat.selectedId.value).toBe('s1')
      expect(chat.accepted.value).toMatchObject({ key: '__new__', content: 'hello' })
      expect(chat.submitting.value).toBe(false)
    }
    finally { wrapper.unmount() }
  })
})
