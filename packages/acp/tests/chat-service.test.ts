import type { AgentChatSend } from '../src'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentChatService, createSessionStore, openAgentSession } from '../src/node'

const binaryPath = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url))
let project: string
let service: ReturnType<typeof createAgentChatService>
const input = (requestId = 'request-a', content = 'hello'): AgentChatSend => ({ requestId, sessionId: null, provider: 'kimi', options: { mode: 'ask', model: null, reasoningEffort: null }, content })
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'agent-service-'))
  await chmod(binaryPath, 0o755)
  service = createAgentChatService(project, config => openAgentSession({ ...config, binaryPath }))
})
afterEach(async () => {
  await service.close()
  await rm(project, { recursive: true, force: true })
})
async function settled(id: string) {
  for (let i = 0; i < 200; i++) {
    const s = (await service.list()).find(s => s.id === id)!
    if (!['connecting', 'working'].includes(s.status))
      return s
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Session did not settle')
}
describe('project chat service', () => {
  it('keeps tool blocks within each message across turns and history reloads', async () => {
    const session = await service.send(input('first', 'tool-sequence'))
    const first = await settled(session.sessionId)
    const original = structuredClone(first.messages[1])
    expect(original.parts?.map(part => part.type)).toEqual(['text', 'tool', 'tool', 'text'])
    await service.send({ ...input('second', 'tool-sequence'), sessionId: session.sessionId })
    const next = await settled(session.sessionId)
    expect(next.messages).toHaveLength(4)
    expect(next.messages[1]).toEqual(original)
    expect(next.messages[1].turnId).not.toBe(next.messages[3].turnId)
    expect(next.tools).toHaveLength(4)
    const expected = structuredClone(next.messages)
    await service.close()
    service = createAgentChatService(project, config => openAgentSession({ ...config, binaryPath }))
    const loaded = (await service.list())[0]
    expect(loaded.messages).toEqual(expected.map(({ streaming: _streaming, ...message }) => message))
    expect(loaded.messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool')).toHaveLength(4)
  })
  it('assigns legacy tools to their recorded turn without rewriting storage', async () => {
    const store = createSessionStore({ projectRoot: project })
    const session = await store.create({ provider: 'kimi', providerCursor: null, options: input().options })
    for (let turn = 1; turn <= 2; turn++) {
      await store.appendEvent(session.id, { type: 'message', message: { id: `user-${turn}`, turnId: `turn-${turn}`, role: 'user', content: [{ type: 'text', text: `Question ${turn}` }], createdAt: turn } })
      await store.appendEvent(session.id, { type: 'turn', turn: { id: `turn-${turn}`, status: 'completed', startedAt: turn, finishedAt: turn, toolCalls: [{ id: 'reused-id', title: `Tool ${turn}`, status: 'completed' }] } })
      await store.appendEvent(session.id, { type: 'message', message: { id: `assistant-${turn}`, turnId: `turn-${turn}`, role: 'assistant', content: [{ type: 'text', text: `Answer ${turn}` }], createdAt: turn } })
    }
    const before = await store.readEvents(session.id)
    const loaded = (await service.list())[0]
    expect(loaded.messages[1].parts?.[0]).toMatchObject({ type: 'tool', tool: { title: 'Tool 1', turnId: 'turn-1', messageId: 'assistant-1' } })
    expect(loaded.messages[3].parts?.[0]).toMatchObject({ type: 'tool', tool: { title: 'Tool 2', turnId: 'turn-2', messageId: 'assistant-2' } })
    expect(await store.readEvents(session.id)).toEqual(before)
  })
  it('persists server-validated command pin metadata across history reloads', async () => {
    const session = await service.send(input())
    await settled(session.sessionId)
    await service.send({ ...input('command', '/review target'), sessionId: session.sessionId, command: { id: 'kimi:command:review', name: 'review', kind: 'skill' } })
    const s = await settled(session.sessionId)
    expect(s.messages[2].command).toEqual({ id: 'kimi:command:review', name: 'review', kind: 'command' })
    expect(s.messages[2].content).toEqual([{ type: 'text', text: '/review target' }])
    await service.close()
    service = createAgentChatService(project, config => openAgentSession({ ...config, binaryPath }))
    expect((await service.list())[0].messages[2].command).toEqual(s.messages[2].command)
  })
  it('sends once, streams snapshots, and reloads disk history', async () => {
    const a = await service.send(input())
    expect(await service.send(input())).toEqual(a)
    const s = await settled(a.sessionId)
    expect(s.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(s.messages[1].content).toEqual([{ type: 'text', text: 'MOCK_OK' }])
    expect(s.messages[1].streaming).toBe(false)
    await service.close()
    service = createAgentChatService(project, config => openAgentSession({ ...config, binaryPath }))
    expect((await service.list())[0].messages).toHaveLength(2)
    await service.send({ ...input('second'), sessionId: a.sessionId })
    expect((await settled(a.sessionId)).messages).toHaveLength(4)
  })
  it('keeps simultaneous sessions separate and locks the provider', async () => {
    const a = await service.send(input('a'))
    const b = await service.send(input('b'))
    expect((await settled(a.sessionId)).messages).toHaveLength(2)
    expect((await settled(b.sessionId)).messages).toHaveLength(2)
    await expect(service.send({ ...input('c'), sessionId: a.sessionId, provider: 'pi' })).rejects.toThrow('switch')
  })
  it('routes permission replies and cancels pending turns', async () => {
    const a = await service.send(input('a', 'permission'))
    const s = await settled(a.sessionId)
    expect(s.status).toBe('waiting')
    await expect(service.permission(a.sessionId, { requestId: 'bad', outcome: 'cancelled' })).rejects.toThrow()
    await service.permission(a.sessionId, { requestId: s.permission!.id, outcome: 'cancelled' })
    expect((await settled(a.sessionId)).status).toBe('idle')
    await service.send({ ...input('b', 'hang'), sessionId: a.sessionId })
    await new Promise(resolve => setTimeout(resolve, 60))
    await service.stop(a.sessionId)
    expect((await settled(a.sessionId)).status).toBe('idle')
  })
  it('validates browser payloads and rejects request ID reuse', async () => {
    await expect(service.send({ ...input(), provider: 'cursor' } as never)).rejects.toThrow()
    await expect(service.send({ ...input(), options: { ...input().options, mode: 'fullAccess' } })).rejects.toThrow()
    await service.send(input())
    await expect(service.send(input('request-a', 'different'))).rejects.toThrow('reused')
  })
})
