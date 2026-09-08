import type { DriverEvent, DriverPrompt, DriverStartOptions, SessionOptions } from '../../schema'
import { randomUUID } from 'node:crypto'
import { nativeCommands } from '../composer-commands'
import { BaseDriver, promptText } from './base'
import { AgentProcess, DriverError, JsonPeer } from './process'

export class PiDriver extends BaseDriver {
  private peer: JsonPeer
  constructor(config: DriverStartOptions, emit: (event: DriverEvent) => void) {
    super(config, emit)
    this.peer = new JsonPeer(new AgentProcess(config.binaryPath ?? 'pi', ['--mode', 'rpc', '--offline', '--no-extensions', '--no-context-files', '--tools', 'read,grep,find,ls'], config.cwd), 'pi', config.requestTimeoutMs)
    this.peer.onMessage = (m) => {
      if (!this.turn)
        return
      if (m.type === 'message_start' && m.message?.role === 'assistant')
        this.assistantMessage(`pi:${m.message.id ?? randomUUID()}`)
      if (m.type === 'message_end' && m.message?.role === 'assistant')
        this.usage(m.message.usage?.input, m.message.usage?.output)
      if (m.type === 'message_update' && m.assistantMessageEvent?.type === 'text_delta')
        this.text(m.assistantMessageEvent.delta)
      if (m.type === 'tool_execution_start')
        this.tool({ id: m.toolCallId, title: m.toolName, status: 'running' })
      if (m.type === 'tool_execution_end')
        this.tool({ id: m.toolCallId, title: this.tools.get(m.toolCallId)?.title ?? 'Tool', status: m.isError ? 'failed' : 'completed' })
      if (m.type === 'message_end' && m.message?.role === 'assistant' && m.message.stopReason === 'error')
        this.fail(new Error(m.message.errorMessage ?? 'Pi inference failed'))
      if (m.type === 'agent_end')
        this.finish()
    }
    this.peer.process.exitListeners.add((exitCode) => {
      if (!this.closed)
        this.fail(new DriverError('disconnected', 'Pi exited'))
      this.emit({ type: 'processExited', exitCode })
    })
  }

  async initialize() {
    if (this.config.options.mode !== 'ask')
      throw new DriverError('unsupported', 'Pi driver is read-only; approval bypass is not supported')
    const cursor = this.config.providerCursor
    if (cursor) {
      if (cursor.provider !== 'pi' || !cursor.sessionFile)
        throw new DriverError('resumeFailed', 'Pi requires its native session file')
      const switched = await this.peer.request({ type: 'switch_session', sessionPath: cursor.sessionFile })
      if (switched.cancelled)
        throw new DriverError('resumeFailed', 'Pi refused session restoration')
    }
    if (this.config.options.model)
      await this.setModel(this.config.options.model)
    if (this.config.options.reasoningEffort)
      await this.peer.request({ type: 'set_thinking_level', level: this.config.options.reasoningEffort })
    const state = await this.peer.request({ type: 'get_state' })
    if (!state.sessionId || (cursor && 'sessionId' in cursor && state.sessionId !== cursor.sessionId))
      throw new DriverError('resumeFailed', 'Pi native session identity mismatch')
    this.capabilities.changeModel = true
    this.emit({ type: 'connected', providerCursor: { provider: 'pi', sessionId: state.sessionId, ...(state.sessionFile ? { sessionFile: state.sessionFile } : {}) }, capabilities: this.capabilities })
    await this.getCommands(true)
  }

  async getCommands(refresh = false) {
    if (!refresh && this.commandCatalog.status !== 'pendingSession')
      return this.commandCatalog
    try {
      const result = await this.peer.request({ type: 'get_commands' }, false)
      return this.publishCommands(nativeCommands('pi', result.commands), Array.isArray(result.commands) ? 'ready' : 'unsupported')
    }
    catch (error) { return this.commandDiscoveryFailed(error) }
  }

  private async setModel(model: string) {
    const slash = model.indexOf('/')
    if (slash < 1)
      throw new DriverError('unsupported', 'Pi model must be provider/model')
    await this.peer.request({ type: 'set_model', provider: model.slice(0, slash), modelId: model.slice(slash + 1) })
  }

  protected async send(prompt: DriverPrompt) {
    const command = prompt.command ? this.selectedCommand(prompt) : undefined
    await this.peer.request({ type: 'prompt', message: command ? `/${command.nativeName} ${prompt.command!.arguments}` : promptText(prompt) })
  }

  async cancel() {
    if (!this.turn)
      return
    this.turn.cancelled = true
    await this.peer.request({ type: 'clear_queue' })
    await this.peer.request({ type: 'abort' })
    this.finish('cancelled')
  }

  async applyOptions(options: SessionOptions): Promise<'applied' | 'restartRequired'> {
    await super.applyOptions(options)
    if (options.mode !== 'ask' || !options.model)
      return 'restartRequired'
    await this.setModel(options.model)
    if (options.reasoningEffort)
      await this.peer.request({ type: 'set_thinking_level', level: options.reasoningEffort })
    this.config.options = options
    return 'applied'
  }

  async close() {
    this.closed = true
    this.finish('cancelled')
    await this.peer.process.stop()
  }
}
