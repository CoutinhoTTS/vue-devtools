import type { AgentMessage, AgentTurn, DriverControl, DriverEvent, DriverPrompt, DriverStartOptions, ProviderBinding } from '../schema'
import { realpath } from 'node:fs/promises'
import { startAgentDriver } from './drivers'
import { DriverError } from './drivers/process'
import { applyAssistantEvent } from './message-projection'
import { createSessionStore } from './storage/session-store'
/** A session has exactly one owner in this process. Storage owns cross-process writes. */
const owners = new Set<string>()
const stores = new Map<string, { store: ReturnType<typeof createSessionStore>, refs: number }>()
export async function openAgentSession({ projectRoot, sessionId, store: suppliedStore, onEvent = () => { }, ...overrides }: {
  projectRoot: string
  sessionId: string
  onEvent?: (event: DriverEvent) => void
  store?: ReturnType<typeof createSessionStore>
} & Pick<DriverStartOptions, 'binaryPath' | 'requestTimeoutMs' | 'turnTimeoutMs'>) {
  const root = await realpath(projectRoot)
  let entry = stores.get(root)
  if (!entry) {
    entry = { store: suppliedStore ?? createSessionStore({ projectRoot: root }), refs: 0 }
    stores.set(root, entry)
  }
  const { store } = entry
  const session = await store.get(sessionId)
  const key = `${session.cwd}:${sessionId}`
  if (owners.has(key))
    throw new DriverError('busy', 'This session already has a runtime')
  owners.add(key)
  entry.refs++
  let released = false
  function release() {
    if (released)
      return
    released = true
    owners.delete(key)
    if (--entry!.refs === 0)
      stores.delete(root)
  }
  let driver: DriverControl | undefined
  let queue = Promise.resolve()
  let failure: unknown
  let turn: AgentTurn | undefined
  const messages = new Map<string, AgentMessage>()
  async function persist(event: DriverEvent) {
    if (event.type === 'connected')
      await store.updateMetadata(sessionId, { provider: event.providerCursor.provider, providerCursor: event.providerCursor } as ProviderBinding)
    if (event.type === 'promptSubmitted')
      await store.appendEvent(sessionId, { type: 'message', message: event.message })
    if (event.type === 'turnStarted') {
      messages.clear()
      turn = { id: event.turnId, status: 'running', startedAt: Date.now(), finishedAt: null, toolCalls: [] }
      await store.appendEvent(sessionId, { type: 'turn', turn })
      await store.updateMetadata(sessionId, { status: 'working' })
    }
    if (event.type === 'textDelta' || event.type === 'toolCallUpdated')
      applyAssistantEvent(messages, event)
    if (event.type === 'toolCallUpdated' && turn) {
      const index = turn.toolCalls.findIndex(t => t.id === event.toolCall.id)
      if (index < 0)
        turn.toolCalls.push(event.toolCall)
      else
        turn.toolCalls[index] = event.toolCall
      for (const message of messages.values())
        await store.appendEvent(sessionId, { type: 'message', message })
      await store.appendEvent(sessionId, { type: 'turn', turn })
    }
    if (event.type === 'permissionRequested' || event.type === 'userInputRequested')
      await store.updateMetadata(sessionId, { status: 'waiting' })
    if (event.type === 'titleUpdated')
      await store.updateMetadata(sessionId, { title: event.title })
    if (event.type === 'turnFinished' && turn) {
      for (const message of messages.values())
        await store.appendEvent(sessionId, { type: 'message', message })
      turn.status = event.reason
      turn.finishedAt = Date.now()
      await store.appendEvent(sessionId, { type: 'turn', turn })
      turn = undefined
      await store.updateMetadata(sessionId, { status: event.reason === 'failed' ? 'failed' : 'idle', lastReplyAt: Date.now() })
    }
    if (event.type === 'error')
      await store.updateMetadata(sessionId, { status: 'failed' })
  }
  const emit = (event: DriverEvent) => {
    const snapshot = structuredClone(event)
    queue = queue.then(async () => {
      if (failure)
        return
      await persist(snapshot)
      onEvent(snapshot)
    }).catch((error) => {
      failure = error
      void driver?.close()
      onEvent({ type: 'error', error: { code: 'internal', message: 'Session persistence failed', retryable: false } })
    })
  }
  const flush = async () => {
    await queue
    if (failure)
      throw failure
  }
  try {
    driver = await startAgentDriver({ provider: session.provider, providerCursor: session.providerCursor, cwd: session.cwd, options: session.options, ...overrides } as DriverStartOptions, emit)
    await flush()
  }
  catch (error) {
    await driver?.close()
    await queue
    release()
    throw error
  }
  return {
    capabilities: driver.capabilities,
    async getCommands(refresh = false) {
      const catalog = await driver!.getCommands?.(refresh) ?? { status: 'unsupported' as const, commands: [] }
      await flush()
      return catalog
    },
    async prompt(prompt: DriverPrompt) {
      await flush()
      await driver!.prompt(prompt)
      await flush()
    },
    async cancel() {
      await driver!.cancel()
      await flush()
    },
    async respondPermission(response: Parameters<DriverControl['respondPermission']>[0]) {
      await driver!.respondPermission(response)
      await flush()
    },
    async respondUserInput(response: Parameters<DriverControl['respondUserInput']>[0]) {
      await driver!.respondUserInput(response)
      await flush()
    },
    async applyOptions(options: Parameters<DriverControl['applyOptions']>[0]) {
      const result = await driver!.applyOptions(options)
      if (result === 'applied')
        await store.updateMetadata(sessionId, { options })
      return result
    },
    flush,
    async close() {
      try {
        await driver!.close()
        await flush()
      }
      finally {
        release()
      }
    },
  }
}
