import type { AgentMessage, DriverControl, DriverEvent, DriverStartOptions } from '../src'
import { Buffer } from 'node:buffer'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionStore, openAgentSession, startAgentDriver } from '../src/node'
import { AgentProcess, JsonLines, JsonPeer } from '../src/node/drivers/process'
import { applyAssistantEvent } from '../src/node/message-projection'

const binaryPath = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url))
let cwd: string
const drivers: DriverControl[] = []
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'acp-driver-test-'))
  await chmod(binaryPath, 0o755)
})
afterEach(async () => {
  await Promise.all(drivers.splice(0).map(d => d.close()))
  await rm(cwd, { recursive: true, force: true })
})
function waitFor(events: DriverEvent[], predicate: (e: DriverEvent) => boolean) {
  return new Promise<DriverEvent>((resolve, reject) => {
    const until = Date.now() + 3000
    const poll = () => {
      const event = events.find(predicate)
      if (event)
        resolve(event)
      else if (Date.now() > until)
        reject(new Error('Event timed out'))
      else
        setTimeout(poll, 5)
    }
    poll()
  })
}
async function open(provider: 'kimi' | 'grok' | 'claude' | 'pi' | 'openCode', overrides: Partial<DriverStartOptions> = {}) {
  const events: DriverEvent[] = []
  const driver = await startAgentDriver({ provider, providerCursor: null, cwd, binaryPath, options: { mode: 'ask', model: null, reasoningEffort: null }, requestTimeoutMs: 1000, turnTimeoutMs: 2000, ...overrides } as DriverStartOptions, e => events.push(e))
  drivers.push(driver)
  return { driver, events }
}
const prompt = (text: string) => ({ turnId: 'turn-1', messageId: 'user-1', content: [{ type: 'text' as const, text }] })
const output = (events: DriverEvent[]) => events.filter(e => e.type === 'textDelta').map(e => e.text).join('')
describe('native drivers', () => {
  for (const provider of ['kimi', 'grok', 'claude', 'pi', 'openCode'] as const) {
    it(`${provider} keeps text and tools in their originating message order`, async () => {
      const { driver, events } = await open(provider)
      await driver.prompt(prompt('tool-sequence'))
      await waitFor(events, e => e.type === 'turnFinished')
      const messages = new Map<string, AgentMessage>()
      for (const event of events) {
        if (event.type === 'textDelta' || event.type === 'toolCallUpdated')
          applyAssistantEvent(messages, event)
      }
      const first = [...messages.values()][0]
      expect(first.parts?.slice(0, 3).map(part => part.type === 'text' ? part.text : part.tool.title)).toEqual(['Before tool. ', 'Read first', 'Read second'])
      const tools = first.parts?.filter(part => part.type === 'tool') ?? []
      expect(tools).toHaveLength(2)
      expect(tools.every(part => part.type === 'tool' && part.tool.status === 'completed' && part.tool.messageId === first.id)).toBe(true)
      expect([...messages.values()].flatMap(m => m.parts ?? []).filter(part => part.type === 'tool')).toHaveLength(2)
      expect(output(events)).toBe('Before tool. After tools. Final answer.')
    })
    it(`${provider} connects and emits only assistant text once`, async () => {
      const { driver, events } = await open(provider)
      expect(events.some(e => e.type === 'connected')).toBe(true)
      await driver.prompt(prompt('hello'))
      await waitFor(events, e => e.type === 'turnFinished')
      expect(output(events)).toBe('MOCK_OK')
      expect(events.filter(e => e.type === 'turnFinished')).toHaveLength(1)
    })
    it(`${provider} cancels and closes without leaving an active turn`, async () => {
      const { driver, events } = await open(provider)
      await driver.prompt(prompt('hang'))
      await expect(driver.prompt(prompt('again'))).rejects.toMatchObject({ code: 'busy' })
      await driver.cancel()
      const end = await waitFor(events, e => e.type === 'turnFinished')
      expect(end).toMatchObject({ reason: 'cancelled' })
      await driver.close()
      await expect(driver.prompt(prompt('closed'))).rejects.toMatchObject({ code: 'disconnected' })
    })
  }
  for (const provider of ['kimi', 'claude'] as const) {
    it(`${provider} returns the selected approval to the agent`, async () => {
      const { driver, events } = await open(provider)
      await driver.prompt(prompt('permission'))
      const request = await waitFor(events, e => e.type === 'permissionRequested')
      if (request.type !== 'permissionRequested')
        throw new Error('Missing request')
      await driver.respondPermission({ requestId: request.request.id, outcome: 'selected', optionId: request.request.options[0].id })
      await waitFor(events, e => e.type === 'turnFinished')
      expect(output(events)).toBe(provider === 'kimi' ? 'yes' : 'ALLOWED')
    })
    it(`${provider} waits for explicit permission and rejects invalid options`, async () => {
      const { driver, events } = await open(provider)
      await driver.prompt(prompt('permission'))
      const request = await waitFor(events, e => e.type === 'permissionRequested')
      if (request.type !== 'permissionRequested')
        throw new Error('Missing request')
      expect(output(events)).toBe('')
      await expect(driver.respondPermission({ requestId: request.request.id, outcome: 'selected', optionId: 'invalid' })).rejects.toMatchObject({ code: 'invalidRequest' })
      await driver.respondPermission({ requestId: request.request.id, outcome: 'cancelled' })
      await waitFor(events, e => e.type === 'turnFinished')
      expect(output(events)).toBe('DENIED')
    })
  }
  it('restoration failures do not create replacement sessions', async () => {
    await expect(open('kimi', { providerCursor: { provider: 'kimi', sessionId: 'missing' } })).rejects.toMatchObject({ code: 'resumeFailed' })
  })
  it('handles Claude user questions separately from tool approval', async () => {
    const { driver, events } = await open('claude')
    await driver.prompt(prompt('question'))
    const request = await waitFor(events, e => e.type === 'userInputRequested')
    if (request.type !== 'userInputRequested')
      throw new Error('Missing question')
    await driver.respondUserInput({ requestId: request.request.id, outcome: 'answered', answers: [{ questionId: '0', optionIds: ['A'] }] })
    await waitFor(events, e => e.type === 'turnFinished')
    expect(output(events)).toBe('ALLOWED')
  })
  it('rejects unimplemented providers, resource inputs and unsafe Pi modes', async () => {
    await expect(startAgentDriver({ provider: 'amp', providerCursor: null, cwd, options: { mode: 'ask', model: null, reasoningEffort: null } }, () => { })).rejects.toMatchObject({ code: 'unsupported' })
    const { driver } = await open('pi')
    await expect(driver.prompt({ ...prompt(''), content: [{ type: 'resource', uri: 'file:///secret', name: 'secret' }] })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(open('pi', { options: { mode: 'fullAccess', model: null, reasoningEffort: null } })).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('finishes a timed-out turn and stops its process', async () => {
    const { driver, events } = await open('pi', { turnTimeoutMs: 30 })
    await driver.prompt(prompt('hang'))
    expect(await waitFor(events, e => e.type === 'turnFinished')).toMatchObject({ reason: 'failed' })
    await waitFor(events, e => e.type === 'processExited')
  })
  it('reports unexpected subprocess exit', async () => {
    const { driver, events } = await open('pi')
    await driver.prompt(prompt('crash'))
    expect(await waitFor(events, e => e.type === 'processExited')).toMatchObject({ exitCode: 7 })
    expect(events.some(e => e.type === 'error')).toBe(true)
  })
  it('isolates two OpenCode sessions sharing a server', async () => {
    const a = await open('openCode')
    const b = await open('openCode')
    await a.driver.prompt(prompt('hello'))
    await waitFor(a.events, e => e.type === 'turnFinished')
    expect(output(b.events)).toBe('')
    await a.driver.close()
    await b.driver.prompt(prompt('hello'))
    await waitFor(b.events, e => e.type === 'turnFinished')
    expect(output(b.events)).toBe('MOCK_OK')
  })
})
describe('session coordination', () => {
  it('persists cursors and snapshots and prevents duplicate runtime owners', async () => {
    const store = createSessionStore({ projectRoot: cwd })
    const session = await store.create({ provider: 'kimi', providerCursor: null, options: { mode: 'ask', model: null, reasoningEffort: null } })
    const events: DriverEvent[] = []
    const options = { projectRoot: cwd, sessionId: session.id, binaryPath, onEvent: (e: DriverEvent) => events.push(e) }
    const runtime = await openAgentSession(options)
    try {
      await expect(openAgentSession(options)).rejects.toMatchObject({ code: 'busy' })
      await runtime.prompt(prompt('hello'))
      await waitFor(events, e => e.type === 'turnFinished')
      await runtime.flush()
      const stored = await store.get(session.id)
      expect(stored.providerCursor).toEqual({ provider: 'kimi', sessionId: 'native-session' })
      expect(stored.status).toBe('idle')
      const log = await store.readEvents(session.id)
      expect(log.events.filter(e => e.event.type === 'message')).toHaveLength(2)
    }
    finally {
      await runtime.close()
    }
    const before = (await store.readEvents(session.id)).events.length
    const restored = await openAgentSession(options)
    await restored.close()
    expect((await store.readEvents(session.id)).events).toHaveLength(before)
  })
  it('surfaces persistence errors rather than reporting a successful turn', async () => {
    const store = createSessionStore({ projectRoot: cwd })
    const session = await store.create({ provider: 'pi', providerCursor: null, options: { mode: 'ask', model: null, reasoningEffort: null } })
    const runtime = await openAgentSession({ projectRoot: cwd, sessionId: session.id, binaryPath })
    const lock = join(cwd, '.vue-devtools/agent/sessions/.write-lock')
    await mkdir(lock)
    try {
      await expect(runtime.prompt(prompt('hello'))).rejects.toThrow('locked')
    }
    finally {
      await runtime.close().catch(() => { })
      await rm(lock, { recursive: true })
    }
  })
})
describe('stdio transport', () => {
  it('handles fragmented UTF-8, CRLF, and Unicode line separators', () => {
    const values: unknown[] = []
    const parser = new JsonLines(v => values.push(v))
    const bytes = Buffer.from(`${JSON.stringify({ text: 'hello \u4E16\u754C\u2028next' })}\r\n`)
    for (const byte of bytes)
      parser.push(Buffer.from([byte]))
    expect(values).toEqual([{ text: 'hello \u4E16\u754C\u2028next' }])
  })
  it('rejects malformed frames', () => {
    expect(() => new JsonLines(() => {}).push(Buffer.from('{bad}\n'))).toThrow()
  })
  it('correlates requests and kills an unresponsive peer on timeout', async () => {
    const child = new AgentProcess(process.execPath, ['-e', 'process.stdin.resume()'], cwd)
    const peer = new JsonPeer(child, 'pi', 30)
    await expect(peer.request({ type: 'get_state' })).rejects.toThrow('timed out')
    await child.exited
  })
})
