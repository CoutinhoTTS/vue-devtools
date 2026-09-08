import type { AgentChatSend, AgentChatSession, AgentMessage, AgentTurn, ChatProviderId, ComposerContext, DriverEvent, PermissionResponse, SessionOptions, UserInputResponse } from '../schema'
import { randomUUID } from 'node:crypto'
import { createComposerCatalog } from './composer-catalog'
import { commandInvocation, newCommand } from './composer-commands'
import { createComposerFileIndex, validateReferences } from './composer-files'
import { DriverError } from './drivers/process'
import { applyAssistantEvent, restoreToolMessages } from './message-projection'
import { supportedAgents } from './provider-catalog'
import { openAgentSession } from './session-runtime'
import { createSessionStore } from './storage/session-store'

const busy = (s: AgentChatSession) => ['connecting', 'working', 'waiting', 'background'].includes(s.status)
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
function optionsValid(v: unknown): asserts v is SessionOptions {
  if (!object(v) || v.mode !== 'ask' || !(v.model === null || typeof v.model === 'string') || !(v.reasoningEffort === null || typeof v.reasoningEffort === 'string'))
    throw new DriverError('invalidRequest', 'Invalid session options (only ask mode is exposed)')
}
/** Project-owned service; UI snapshots can be fetched repeatedly without replay races. */
export function createAgentChatService(projectRoot: string, open = openAgentSession) {
  const composer = createComposerCatalog(projectRoot)
  const files = createComposerFileIndex(projectRoot)
  const store = createSessionStore({ projectRoot })
  const sessions = new Map<string, AgentChatSession>()
  const messageIndexes = new Map<string, Map<string, AgentMessage>>()
  const runtimes = new Map<string, Awaited<ReturnType<typeof openAgentSession>>>()
  const tasks = new Set<Promise<unknown>>()
  const cancelledStarts = new Set<string>()
  const requests = new Map<string, {
    input: string
    result: {
      sessionId: string
    }
  }>()
  let queue = Promise.resolve()
  let initialized: Promise<void> | undefined
  let closed = false
  async function initialize() {
    return initialized ??= (async () => {
      for (const record of await store.list()) {
        if (!(supportedAgents as readonly string[]).includes(record.provider))
          continue
        const messages = new Map<string, AgentChatSession['messages'][number]>()
        const tools = new Map<string, ToolCallLocal>()
        const turns = new Map<string, AgentTurn>()
        const history = await store.readEvents(record.id)
        for (const { event } of history.events) {
          if (event.type === 'message') {
            messages.set(event.message.id, event.message)
          }
          else {
            turns.set(event.turn.id, event.turn)
            for (const tool of event.turn.toolCalls)
              tools.set(`${event.turn.id}:${tool.id}`, { ...tool, turnId: event.turn.id })
          }
        }
        const restored = restoreToolMessages([...messages.values()], [...turns.values()])
        messageIndexes.set(record.id, new Map(restored.map(message => [message.id, message])))
        sessions.set(record.id, { id: record.id, title: record.title, provider: record.provider as AgentChatSession['provider'], options: record.options, status: record.status === 'failed' ? 'failed' : 'idle', messages: restored, tools: [...tools.values()], ...(history.incompleteTail ? { error: 'An interrupted log entry was recovered.' } : {}) })
      }
    })()
  }
  type ToolCallLocal = AgentChatSession['tools'][number]
  function locked<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      if (closed)
        throw new DriverError('disconnected', 'Agent service is closed')
      await initialize()
      return action()
    })
    queue = result.then(() => { }, () => { })
    return result
  }
  function get(id: string) {
    if (typeof id !== 'string' || !sessions.has(id))
      throw new DriverError('invalidRequest', 'Unknown project session')
    return sessions.get(id)!
  }
  function event(id: string, e: DriverEvent) {
    const s = get(id)
    if (e.type === 'commandsUpdated')
      s.commands = e.catalog
    if (e.type === 'promptSubmitted' && !s.messages.some(m => m.id === e.message.id))
      s.messages.push(e.message)
    if (e.type === 'turnStarted')
      s.status = 'working'
    if (e.type === 'textDelta' || e.type === 'toolCallUpdated') {
      let index = messageIndexes.get(id)
      if (!index) {
        index = new Map(s.messages.map(message => [message.id, message]))
        messageIndexes.set(id, index)
      }
      const message = applyAssistantEvent(index, e)
      if (!s.messages.some(m => m.id === message.id))
        s.messages.push(message)
      Object.assign(message, { streaming: true })
    }
    if (e.type === 'toolCallUpdated') {
      const tool = { ...e.toolCall, turnId: e.turnId }
      const at = s.tools.findIndex(t => t.id === tool.id && t.turnId === tool.turnId)
      if (at < 0)
        s.tools.push(tool)
      else
        s.tools[at] = tool
    }
    if (e.type === 'permissionRequested') {
      s.permission = e.request
      s.status = 'waiting'
    }
    if (e.type === 'userInputRequested') {
      s.question = e.request
      s.status = 'waiting'
    }
    if (e.type === 'titleUpdated')
      s.title = e.title
    if (e.type === 'turnFinished') {
      s.status = e.reason === 'failed' ? 'failed' : 'idle'
      s.messages.forEach(m => m.streaming = false)
      delete s.permission
      delete s.question
    }
    if (e.type === 'error') {
      s.status = 'failed'
      s.error = e.error.message
    }
    if (e.type === 'processExited') {
      delete s.commands
      const runtime = runtimes.get(id)
      runtimes.delete(id)
      void runtime?.close().catch(() => { })
    }
  }
  async function runtime(id: string) {
    if (runtimes.has(id))
      return runtimes.get(id)!
    const r = await open({ projectRoot, store, sessionId: id, onEvent: e => event(id, e) })
    runtimes.set(id, r)
    return r
  }
  return {
    invalidateComposer() {
      files.invalidate()
      composer.invalidate()
    },
    searchFiles: (query: string) => files.search(query),
    async commands(context: ComposerContext, refresh = false) {
      await initialize()
      if (closed || !object(context) || !(supportedAgents as readonly string[]).includes(context.provider) || typeof refresh !== 'boolean')
        throw new DriverError('invalidRequest', 'Invalid composer request')
      if (context.sessionId !== null) {
        const session = get(context.sessionId)
        if (session.provider !== context.provider)
          throw new DriverError('invalidRequest', 'Agent does not match session')
        const runtime = runtimes.get(session.id)
        if (runtime) {
          const catalog = await runtime.getCommands(refresh)
          return { ...catalog, commands: [newCommand, ...catalog.commands] }
        }
      }
      const catalog = await composer.get(context.provider as ChatProviderId, refresh)
      return { ...catalog, commands: [newCommand, ...catalog.commands] }
    },
    async list() {
      if (closed)
        throw new DriverError('disconnected', 'Agent service is closed')
      await initialize()
      return structuredClone([...sessions.values()])
    },
    send(input: AgentChatSend) {
      input = structuredClone(input)
      return locked(async () => {
        if (!object(input) || typeof input.requestId !== 'string' || !/^[\w-]{1,100}$/.test(input.requestId) || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 100000 || !(supportedAgents as readonly string[]).includes(input.provider))
          throw new DriverError('invalidRequest', 'Invalid chat request')
        optionsValid(input.options)
        const fingerprint = JSON.stringify(input)
        const previous = requests.get(input.requestId)
        if (previous) {
          if (previous.input !== fingerprint)
            throw new DriverError('invalidRequest', 'Request ID reused with different input')
          return previous.result
        }
        const referenceContext = await validateReferences(projectRoot, input.content, input.references)
        const invocation = commandInvocation(input.content)
        if (input.command && (!object(input.command) || typeof input.command.id !== 'string' || input.command.name !== invocation?.name))
          throw new DriverError('invalidRequest', 'Command selection no longer matches the message')
        let command: { id: string, name: string, arguments: string } | undefined
        if (invocation) {
          if (invocation.name === 'new')
            throw new DriverError('invalidRequest', 'New conversation is an application command')
          const existing = input.sessionId === null ? undefined : get(input.sessionId)
          if (existing && existing.provider !== input.provider)
            throw new DriverError('invalidRequest', 'Cannot switch session agent')
          if (existing && busy(existing))
            throw new DriverError('busy', 'Session is running')
          const r = existing && runtimes.get(existing.id)
          const catalog = r ? await r.getCommands(true) : await composer.get(input.provider, true)
          const selected = catalog.commands.find(c => c.name === invocation.name && (!input.command || c.id === input.command.id))
          if (!selected || catalog.status !== 'ready')
            throw new DriverError('unsupported', 'Unknown or unavailable command. Refresh commands and try again.')
          command = { id: selected.id, name: selected.name, arguments: invocation.arguments + referenceContext }
        }
        let s: AgentChatSession
        if (input.sessionId !== null) {
          s = get(input.sessionId)
          if (s.provider !== input.provider)
            throw new DriverError('invalidRequest', 'Cannot switch session agent')
          if (busy(s))
            throw new DriverError('busy', 'Session is running')
          if (JSON.stringify(s.options) !== JSON.stringify(input.options))
            throw new DriverError('invalidRequest', 'Apply options before sending')
        }
        else {
          const record = await store.create({ provider: input.provider, providerCursor: null, options: input.options, title: input.content.trim().slice(0, 70) })
          s = { id: record.id, title: record.title, provider: input.provider, options: record.options, status: 'idle', messages: [], tools: [] }
          sessions.set(s.id, s)
        }
        s.status = 'connecting'
        delete s.error
        const result = { sessionId: s.id }
        requests.set(input.requestId, { input: fingerprint, result })
        if (requests.size > 1000)
          requests.delete(requests.keys().next().value!)
        const id = s.id
        const task = (async () => {
          try {
            const r = await runtime(id)
            if (closed || cancelledStarts.delete(id)) {
              await r.close()
              runtimes.delete(id)
              s.status = 'idle'
              return
            }
            await validateReferences(projectRoot, input.content, input.references)
            await r.prompt({ turnId: randomUUID(), messageId: input.requestId, content: [{ type: 'text', text: input.content.trim() + referenceContext }], displayContent: [{ type: 'text', text: input.content }], references: input.references, command })
          }
          catch (error) {
            s.error = error instanceof Error ? error.message : 'Agent failed'
            s.status = 'failed'
            const r = runtimes.get(id)
            runtimes.delete(id)
            await r?.close().catch(() => { })
          }
        })()
        tasks.add(task)
        void task.finally(() => tasks.delete(task))
        return result
      })
    },
    async stop(id: string) {
      await initialize()
      const s = get(id)
      if (s.status === 'connecting') {
        cancelledStarts.add(id)
        return
      }
      await runtimes.get(id)?.cancel()
    },
    async permission(id: string, response: PermissionResponse) {
      const s = get(id)
      if (!s.permission || !runtimes.has(id) || !object(response) || response.requestId !== s.permission.id || !['selected', 'cancelled'].includes(response.outcome))
        throw new DriverError('invalidRequest', 'Unknown permission')
      await runtimes.get(id)!.respondPermission(response)
      delete s.permission
      if (s.status === 'waiting')
        s.status = 'working'
    },
    async answer(id: string, response: UserInputResponse) {
      const s = get(id)
      if (!s.question || !runtimes.has(id) || !object(response) || response.requestId !== s.question.id || !['answered', 'cancelled'].includes(response.outcome) || (response.outcome === 'answered' && (!Array.isArray(response.answers) || response.answers.some(a => !object(a) || typeof a.questionId !== 'string' || !Array.isArray(a.optionIds) || a.optionIds.some(v => typeof v !== 'string') || (a.text !== undefined && typeof a.text !== 'string')))))
        throw new DriverError('invalidRequest', 'Unknown question')
      await runtimes.get(id)!.respondUserInput(response)
      delete s.question
      if (s.status === 'waiting')
        s.status = 'working'
    },
    options(id: string, options: SessionOptions) {
      return locked(async () => {
        optionsValid(options)
        const s = get(id)
        if (busy(s))
          throw new DriverError('busy', 'Session is running')
        const r = runtimes.get(id)
        if (r) {
          await r.close()
          runtimes.delete(id)
        }
        await store.updateMetadata(id, { options })
        s.options = structuredClone(options)
      })
    },
    async close() {
      closed = true
      await queue
      await Promise.allSettled(tasks)
      await Promise.allSettled([...runtimes.values()].map(r => r.close()))
      runtimes.clear()
    },
  }
}
