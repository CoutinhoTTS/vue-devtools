import type { AgentMessage, DriverEvent } from '../src'
import { describe, expect, it } from 'vitest'
import { applyAssistantEvent, restoreToolMessages } from '../src/node/message-projection'

describe('ordered assistant display projection', () => {
  it('updates a tool in place when its completion arrives after later text and tools', () => {
    const messages = new Map<string, AgentMessage>()
    const text = (text: string, messageId = 'a1') => applyAssistantEvent(messages, { type: 'textDelta', turnId: 't1', messageId, text })
    const tool = (id: string, status: 'running' | 'completed') => applyAssistantEvent(messages, { type: 'toolCallUpdated', turnId: 't1', toolCall: { id, messageId: 'a1', title: id, status } })
    text('Before')
    tool('first', 'running')
    text('Middle')
    tool('second', 'running')
    text('After', 'a2')
    tool('second', 'completed')
    tool('first', 'completed')
    expect([...messages.keys()]).toEqual(['a1', 'a2'])
    expect(messages.get('a1')?.parts?.map(part => part.type === 'text' ? part.text : part.tool.title)).toEqual(['Before', 'first', 'Middle', 'second'])
    expect(messages.get('a1')?.content).toEqual([{ type: 'text', text: 'BeforeMiddle' }])
    expect(messages.get('a2')?.parts).toEqual([{ type: 'text', text: 'After' }])
  })
  it('creates a visible message immediately for tool-only turns', () => {
    const messages = new Map<string, AgentMessage>()
    const event: Extract<DriverEvent, { type: 'toolCallUpdated' }> = { type: 'toolCallUpdated', turnId: 't1', toolCall: { id: 'tool', messageId: 'owner', title: 'Read file', status: 'running' } }
    const message = applyAssistantEvent(messages, event)
    expect(message.id).toBe('owner')
    expect(message.content).toEqual([])
    expect(message.parts?.[0]).toMatchObject({ type: 'tool', tool: { messageId: 'owner', turnId: 't1' } })
    applyAssistantEvent(messages, { ...event, toolCall: { ...event.toolCall, status: 'cancelled' } })
    expect(message.parts).toHaveLength(1)
    expect(message.parts?.[0]).toMatchObject({ tool: { status: 'cancelled' } })
  })
  it('recovers a legacy tool-only turn between the correct user messages', () => {
    const messages: AgentMessage[] = [1, 2].map(index => ({ id: `u${index}`, turnId: `t${index}`, role: 'user', content: [{ type: 'text', text: 'question' }], createdAt: index }))
    restoreToolMessages(messages, [{ id: 't1', status: 'failed', startedAt: 1, finishedAt: 1, toolCalls: [{ id: 'tool', title: 'Read', status: 'failed' }] }])
    expect(messages.map(m => m.id)).toEqual(['u1', 'tools:t1', 'u2'])
  })
})
