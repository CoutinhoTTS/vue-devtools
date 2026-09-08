import type { DriverPrompt, DriverStartOptions } from '../../schema'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { nativeCommands, publicCatalog } from '../composer-commands'
import { BaseDriver, promptText } from './base'
import { AgentProcess, deadline, DriverError } from './process'

interface Server {
  process: AgentProcess
  url: string
  authorization: string
  refs: number
}
const servers = new Map<string, Promise<Server>>()
async function serverCommands(server: Server) {
  const response = await fetch(`${server.url}/command`, { headers: { Authorization: server.authorization }, signal: AbortSignal.timeout(10000) })
  if (!response.ok)
    throw new Error(`Command catalog HTTP ${response.status}`)
  const commands = await response.json()
  if (!Array.isArray(commands))
    throw new Error('Unsupported command catalog')
  return nativeCommands('openCode', commands)
}

export async function discoverOpenCodeCommands(config: DriverStartOptions) {
  const lease = await acquire(config)
  try {
    return publicCatalog(await serverCommands(lease.server))
  }
  finally {
    if (--lease.server.refs === 0) {
      servers.delete(lease.key)
      await lease.server.process.stop()
    }
  }
}
async function acquire(config: DriverStartOptions): Promise<{
  key: string
  server: Server
}> {
  const key = JSON.stringify([await realpath(config.cwd), config.binaryPath ?? 'opencode'])
  let pending = servers.get(key)
  if (!pending) {
    pending = (async () => {
      const password = randomBytes(24).toString('hex')
      const process = new AgentProcess(config.binaryPath ?? 'opencode', ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '0'], config.cwd, { ...globalThis.process.env, OPENCODE_SERVER_PASSWORD: password })
      let output = ''
      try {
        const url = await deadline(new Promise<string>((resolve, reject) => {
          process.stdoutListeners.add((chunk) => {
            output = (output + chunk.toString()).slice(-8192)
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
            if (match)
              resolve(match[0])
          })
          process.exitListeners.add(() => reject(new DriverError('disconnected', 'OpenCode server exited')))
        }), config.requestTimeoutMs)
        return { process, url, authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, refs: 0 }
      }
      catch (error) {
        await process.stop()
        throw error
      }
    })()
    servers.set(key, pending)
  }
  try {
    const server = await pending
    server.refs++
    return { key, server }
  }
  catch (error) {
    servers.delete(key)
    throw error
  }
}
export class OpenCodeDriver extends BaseDriver {
  private lease?: {
    key: string
    server: Server
  }

  private sessionId = ''
  private streamAbort = new AbortController()
  private streamTask?: Promise<void>
  private seenText = new Map<string, string>()
  private deltaParts = new Set<string>()
  private assistantMessages = new Set<string>()
  private textParts = new Set<string>()
  async initialize() {
    this.lease = await acquire(this.config)
    const cursor = this.config.providerCursor
    const permission = [{ permission: '*', pattern: '*', action: this.config.options.mode === 'fullAccess' ? 'allow' : 'ask' }]
    if (this.config.options.mode === 'acceptEdits')
      permission.push({ permission: 'edit', pattern: '*', action: 'allow' })
    if (cursor) {
      if (cursor.provider !== 'openCode')
        throw new DriverError('resumeFailed', 'Wrong OpenCode cursor')
      const session = await this.http(`/session/${encodeURIComponent(cursor.sessionId)}`)
      if (session.id !== cursor.sessionId || await realpath(session.directory) !== await realpath(this.config.cwd))
        throw new DriverError('resumeFailed', 'OpenCode session does not match project')
      this.sessionId = session.id
      await this.http(`/session/${this.sessionId}`, 'PATCH', { permission })
    }
    else {
      const session = await this.http('/session', 'POST', { permission })
      this.sessionId = session.id
    }
    const response = await deadline(this.fetch('/event', { signal: this.streamAbort.signal, headers: { Accept: 'text/event-stream' } }), this.config.requestTimeoutMs)
    if (!response.ok || !response.body)
      throw new DriverError('disconnected', 'OpenCode event stream unavailable')
    this.streamTask = this.consume(response.body).catch((error) => {
      if (!this.closed) {
        this.fail(error)
        this.closed = true
        this.streamAbort.abort()
      }
    })
    this.capabilities.permissions = true
    this.capabilities.userInput = true
    this.emit({ type: 'connected', providerCursor: { provider: 'openCode', sessionId: this.sessionId }, capabilities: this.capabilities })
    await this.getCommands(true)
  }

  async getCommands(refresh = false) {
    if (!refresh && this.commandCatalog.status !== 'pendingSession')
      return this.commandCatalog
    try {
      return this.publishCommands(await serverCommands(this.lease!.server))
    }
    catch (error) { return this.commandDiscoveryFailed(error) }
  }

  private fetch(path: string, init: RequestInit = {}) {
    const server = this.lease!.server
    return fetch(server.url + path, { ...init, headers: { 'Authorization': server.authorization, 'Content-Type': 'application/json', ...init.headers } })
  }

  private async http(path: string, method = 'GET', body?: unknown, timeout = this.config.requestTimeoutMs ?? 30000) {
    const response = await this.fetch(path, { method, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) })
    if (!response.ok)
      throw new DriverError('internal', `OpenCode HTTP ${response.status}`)
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  private async consume(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          if (!this.closed)
            throw new DriverError('disconnected', 'OpenCode event stream ended')
          return
        }
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data)
            this.receive(JSON.parse(data))
          index = buffer.indexOf('\n\n')
        }
        if (buffer.length > 8 * 1024 * 1024)
          throw new DriverError('invalidRequest', 'OpenCode event too large')
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  private receive(event: any) {
    const p = event.properties ?? {}
    const part = p.part
    if (!this.turn || (p.sessionID ?? part?.sessionID ?? p.info?.sessionID) !== this.sessionId)
      return
    if (event.type === 'message.updated' && p.info?.role === 'assistant')
      this.assistantMessages.add(p.info.id)
    if (event.type === 'message.updated' && p.info?.role === 'assistant')
      this.usage(p.info.tokens?.input, p.info.tokens?.output)
    if (event.type === 'message.part.updated' && part?.type === 'text' && this.assistantMessages.has(part.messageID))
      this.textParts.add(part.id)
    if (event.type === 'message.part.delta' && p.field === 'text' && this.assistantMessages.has(p.messageID) && this.textParts.has(p.partID)) {
      this.deltaParts.add(p.partID)
      this.text(p.delta, p.messageID)
    }
    if (event.type === 'message.part.updated' && part?.type === 'text' && this.assistantMessages.has(part.messageID) && !this.deltaParts.has(part.id)) {
      const old = this.seenText.get(part.id) ?? ''
      if (part.text?.startsWith(old))
        this.text(part.text.slice(old.length), part.messageID)
      this.seenText.set(part.id, part.text ?? '')
    }
    if (event.type === 'message.part.updated' && part?.type === 'tool')
      this.tool({ id: part.callID, title: part.tool, status: part.state.status === 'error' ? 'failed' : part.state.status }, part.messageID)
    if (event.type === 'permission.asked') {
      this.permissions.set(p.id, { ids: ['once', 'reject'], reply: async r => this.http(`/permission/${encodeURIComponent(p.id)}/reply`, 'POST', { reply: r.outcome === 'selected' && r.optionId === 'once' ? 'once' : 'reject' }) })
      this.emit({ type: 'permissionRequested', turnId: this.turn.turnId, request: { id: p.id, title: p.permission, detail: (p.patterns ?? []).join(', '), options: [{ id: 'once', label: 'Allow once', kind: 'allowOnce' }, { id: 'reject', label: 'Deny', kind: 'denyOnce' }] } })
    }
    if (event.type === 'question.asked') {
      this.questions.set(p.id, async (r) => {
        if (r.outcome === 'cancelled') {
          await this.http(`/question/${p.id}/reject`, 'POST', {})
          return
        }
        const answers = p.questions.map((_: unknown, i: number) => {
          const a = r.answers.find(a => a.questionId === String(i))
          return a ? [...a.optionIds, ...(a.text ? [a.text] : [])] : []
        })
        await this.http(`/question/${p.id}/reply`, 'POST', { answers })
      })
      this.emit({ type: 'userInputRequested', turnId: this.turn.turnId, request: { id: p.id, questions: p.questions.map((q: any, i: number) => ({ id: String(i), prompt: q.question, options: q.options.map((o: any) => ({ id: o.label, label: o.label })), multiple: !!q.multiple, allowText: q.custom !== false })) } })
    }
    if (event.type === 'session.error')
      this.fail(new Error(p.error?.data?.message ?? 'OpenCode inference failed'))
    if (event.type === 'session.idle' || (event.type === 'session.status' && p.status?.type === 'idle'))
      this.finish()
  }

  protected async send(prompt: DriverPrompt) {
    this.seenText.clear()
    this.deltaParts.clear()
    this.assistantMessages.clear()
    this.textParts.clear()
    if (prompt.command) {
      const command = this.selectedCommand(prompt)
      await this.http(`/session/${this.sessionId}/command`, 'POST', { command: command.nativeName, arguments: prompt.command.arguments, ...(this.config.options.model ? { model: this.config.options.model } : {}), ...(this.config.options.reasoningEffort ? { variant: this.config.options.reasoningEffort } : {}) }, this.config.turnTimeoutMs ?? 120000)
      return
    }
    let model: {
      providerID: string
      modelID: string
    } | undefined
    if (this.config.options.model) {
      const slash = this.config.options.model.indexOf('/')
      if (slash < 1)
        throw new DriverError('unsupported', 'OpenCode model must be provider/model')
      model = { providerID: this.config.options.model.slice(0, slash), modelID: this.config.options.model.slice(slash + 1) }
    }
    await this.http(`/session/${this.sessionId}/prompt_async`, 'POST', { parts: [{ type: 'text', text: promptText(prompt) }], ...(model ? { model } : {}), ...(this.config.options.reasoningEffort ? { variant: this.config.options.reasoningEffort } : {}) })
  }

  async cancel() {
    if (!this.turn)
      return
    this.turn.cancelled = true
    await this.dismiss()
    await this.http(`/session/${this.sessionId}/abort`, 'POST', {})
    this.finish('cancelled')
  }

  async close() {
    if (!this.lease)
      return
    if (this.turn)
      await this.cancel().catch(() => { })
    this.closed = true
    this.streamAbort.abort()
    await this.streamTask
    const lease = this.lease
    this.lease = undefined
    if (--lease.server.refs === 0) {
      servers.delete(lease.key)
      await lease.server.process.stop()
    }
  }
}
