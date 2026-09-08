import type { DriverEvent, DriverPrompt, DriverStartOptions, PermissionOption } from '../../schema'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { nativeCommands } from '../composer-commands'
import { BaseDriver } from './base'
import { AgentProcess, deadline, DriverError } from './process'

export class AcpDriver extends BaseDriver {
  private process: AgentProcess
  private connection: ClientSideConnection
  private sessionId = ''
  private active?: Promise<unknown>
  private initialCommands = new Map<string, unknown>()
  constructor(config: DriverStartOptions, emit: (event: DriverEvent) => void) {
    super(config, emit)
    this.process = new AgentProcess(config.binaryPath ?? config.provider, config.provider === 'kimi' ? ['acp'] : ['agent', '--no-leader', 'stdio'], config.cwd)
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: async ({ sessionId, update }) => {
        if (update.sessionUpdate === 'available_commands_update') {
          if (!this.sessionId)
            this.initialCommands.set(sessionId, update.availableCommands)
          else if (sessionId === this.sessionId)
            this.publishCommands(nativeCommands(this.config.provider as 'kimi' | 'grok', update.availableCommands))
          return
        }
        if (!this.turn || sessionId !== this.sessionId)
          return
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
          this.text(update.content.text)
        if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
          const old = this.tools.get(update.toolCallId)
          this.tool({ id: update.toolCallId, title: update.title ?? old?.title ?? 'Tool', status: update.status === 'in_progress' ? 'running' : update.status ?? old?.status ?? 'pending' })
        }
      },
      requestPermission: async (request) => {
        if (!this.turn || request.sessionId !== this.sessionId)
          return { outcome: { outcome: 'cancelled' } }
        const id = randomUUID()
        const options: PermissionOption[] = request.options.map(o => ({ id: o.optionId, label: o.name, kind: ({ allow_once: 'allowOnce', allow_always: 'allowSession', reject_once: 'denyOnce', reject_always: 'denySession' } as const)[o.kind] }))
        return new Promise((resolve) => {
          this.permissions.set(id, { ids: options.map(o => o.id), reply: async r => resolve({ outcome: r.outcome === 'cancelled' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: r.optionId } }) })
          this.emit({ type: 'permissionRequested', turnId: this.turn!.turnId, request: { id, title: request.toolCall.title ?? 'Tool permission', detail: '', options } })
        })
      },
    }), ndJsonStream(Writable.toWeb(this.process.child.stdin), Readable.toWeb(this.process.child.stdout) as unknown as ReadableStream<Uint8Array>))
    this.process.exitListeners.add((exitCode) => {
      if (!this.closed)
        this.fail(new DriverError('disconnected', 'ACP process exited'))
      this.emit({ type: 'processExited', exitCode })
    })
  }

  async initialize() {
    const info = await deadline(this.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'vue-devtools', version: '8.2.1' }, clientCapabilities: { terminal: false, fs: { readTextFile: false, writeTextFile: false } } }), this.config.requestTimeoutMs)
    const cursor = this.config.providerCursor
    const args = { cwd: this.config.cwd, mcpServers: [] }
    let session: any
    if (cursor) {
      if (!('sessionId' in cursor) || !info.agentCapabilities?.loadSession)
        throw new DriverError('resumeFailed', 'Agent cannot restore this session')
      this.sessionId = cursor.sessionId
      session = await deadline(this.connection.loadSession({ ...args, sessionId: this.sessionId }), this.config.requestTimeoutMs)
    }
    else {
      session = await deadline(this.connection.newSession(args), this.config.requestTimeoutMs)
      this.sessionId = session.sessionId
    }
    const modeNames = this.config.options.mode === 'ask' ? ['default', 'manual', 'ask'] : this.config.options.mode === 'acceptEdits' ? ['acceptEdits', 'accept_edits'] : ['bypassPermissions', 'yolo', 'auto']
    const mode = session.modes?.availableModes?.find((m: any) => modeNames.includes(m.id))
    if (mode)
      await deadline(this.connection.setSessionMode({ sessionId: this.sessionId, modeId: mode.id }), this.config.requestTimeoutMs)
    else if (this.config.options.mode !== 'ask' || (session.modes?.currentModeId && !modeNames.includes(session.modes.currentModeId)))
      throw new DriverError('unsupported', 'Requested access mode is not advertised')
    for (const [category, value] of [['model', this.config.options.model], ['thought_level', this.config.options.reasoningEffort]]) {
      if (!value)
        continue
      const option = session.configOptions?.find((o: any) => o.category === category)
      if (!option)
        throw new DriverError('unsupported', 'Requested model or effort control is unavailable')
      await deadline(this.connection.setSessionConfigOption({ sessionId: this.sessionId, configId: option.id, value }), this.config.requestTimeoutMs)
    }
    this.capabilities.resume = !!info.agentCapabilities?.loadSession
    this.capabilities.permissions = true
    this.emit({ type: 'connected', providerCursor: { provider: this.config.provider as 'kimi' | 'grok', sessionId: this.sessionId }, capabilities: this.capabilities })
    const commands = this.initialCommands.get(this.sessionId)
    this.initialCommands.clear()
    if (commands)
      this.publishCommands(nativeCommands(this.config.provider as 'kimi' | 'grok', commands))
  }

  protected async send(prompt: DriverPrompt) {
    this.active = this.connection.prompt({ sessionId: this.sessionId, prompt: prompt.content as {
      type: 'text'
      text: string
    }[] }).then(result => this.finish(result.stopReason === 'cancelled' ? 'cancelled' : 'completed'), (error) => {
      if (!this.closed)
        this.fail(error)
    })
  }

  async cancel() {
    if (!this.turn)
      return
    this.turn.cancelled = true
    await this.dismiss()
    await this.connection.cancel({ sessionId: this.sessionId })
    try {
      await deadline(this.active!, this.config.requestTimeoutMs)
    }
    catch (error) {
      await this.close()
      throw error
    }
  }

  async close() {
    this.closed = true
    await this.dismiss()
    this.finish('cancelled')
    await this.process.stop()
  }
}
