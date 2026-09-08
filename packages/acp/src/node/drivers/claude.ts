import type { DriverEvent, DriverPrompt, DriverStartOptions } from '../../schema'
import { randomUUID } from 'node:crypto'
import { claudeCommandMetadata } from '../claude-command-metadata'
import { nativeCommands } from '../composer-commands'
import { BaseDriver, promptText } from './base'
import { AgentProcess, DriverError, JsonPeer } from './process'

export class ClaudeDriver extends BaseDriver {
  private peer: JsonPeer
  private sessionId: string
  private streamed = false
  constructor(config: DriverStartOptions, emit: (event: DriverEvent) => void) {
    super(config, emit)
    const cursor = config.providerCursor
    this.sessionId = cursor && 'sessionId' in cursor ? cursor.sessionId : randomUUID()
    const mode = { ask: 'default', acceptEdits: 'acceptEdits', fullAccess: 'bypassPermissions' }[config.options.mode]
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', mode, '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true })]
    args.push(cursor ? '--resume' : '--session-id', this.sessionId)
    if (cursor?.provider === 'claude' && cursor.resumeAt)
      args.push('--resume-session-at', cursor.resumeAt)
    if (config.options.model)
      args.push('--model', config.options.model)
    if (config.options.reasoningEffort)
      args.push('--effort', config.options.reasoningEffort)
    this.peer = new JsonPeer(new AgentProcess(config.binaryPath ?? 'claude', args, config.cwd), 'claude', config.requestTimeoutMs)
    this.peer.onMessage = m => this.receive(m)
    this.peer.process.exitListeners.add((exitCode) => {
      if (!this.closed)
        this.fail(new DriverError('disconnected', 'Claude exited'))
      this.emit({ type: 'processExited', exitCode })
    })
  }

  async initialize() {
    const init = await this.peer.request({ subtype: 'initialize', hooks: {} })
    this.capabilities.permissions = true
    this.capabilities.userInput = true
    this.emit({ type: 'connected', providerCursor: { provider: 'claude', sessionId: this.sessionId }, capabilities: this.capabilities })
    this.publishCommands(await claudeCommandMetadata(nativeCommands('claude', init.commands), this.config.cwd), Array.isArray(init.commands) ? 'ready' : 'unsupported')
  }

  private async reply(id: string, response: unknown) {
    await this.peer.process.write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })
  }

  private receive(m: any) {
    if (m.type === 'system' && m.subtype === 'init' && (!m.session_id || m.session_id === this.sessionId) && Array.isArray(m.slash_commands)) {
      const commands = nativeCommands('claude', m.slash_commands.map((c: any) => typeof c === 'string' ? { name: c } : c))
      this.publishCommands(commands.map(command => this.commands.find(old => old.name === command.name) ?? command))
    }
    if (m.type === 'control_request') {
      const id = m.request_id
      const r = m.request
      if (!this.turn || r?.subtype !== 'can_use_tool') {
        void this.reply(id, { behavior: 'deny', message: 'Unsupported control request' }).catch(e => this.fail(e))
        return
      }
      if (r.tool_name === 'AskUserQuestion') {
        const questions = (r.input?.questions ?? []).map((q: any, i: number) => ({ id: String(i), prompt: q.question, options: (q.options ?? []).map((o: any) => ({ id: o.label, label: o.label })), multiple: !!q.multiSelect, allowText: true }))
        this.questions.set(id, async (answer) => {
          if (answer.outcome === 'cancelled')
            return this.reply(id, { behavior: 'deny', message: 'Question cancelled' })
          const answers: Record<string, string> = {}
          for (const a of answer.answers) {
            const q = questions.find((q: any) => q.id === a.questionId)
            if (!q)
              throw new DriverError('invalidRequest', 'Unknown question')
            answers[q.prompt] = a.text ?? a.optionIds.join(', ')
          }
          await this.reply(id, { behavior: 'allow', updatedInput: { ...r.input, answers } })
        })
        this.emit({ type: 'userInputRequested', turnId: this.turn.turnId, request: { id, questions } })
      }
      else {
        this.permissions.set(id, { ids: ['allow', 'deny'], reply: async a => this.reply(id, a.outcome === 'selected' && a.optionId === 'allow' ? { behavior: 'allow', updatedInput: r.input } : { behavior: 'deny', message: 'Denied by client' }) })
        this.emit({ type: 'permissionRequested', turnId: this.turn.turnId, request: { id, title: r.tool_name ?? 'Tool', detail: 'Agent requests tool access', options: [{ id: 'allow', label: 'Allow once', kind: 'allowOnce' }, { id: 'deny', label: 'Deny', kind: 'denyOnce' }] } })
      }
      return
    }
    if (!this.turn)
      return
    if (m.session_id && m.session_id !== this.sessionId) {
      this.fail(new DriverError('resumeFailed', 'Claude session identity changed'))
      void this.close()
      return
    }
    if (m.type === 'stream_event') {
      const e = m.event
      if (e?.type === 'message_start' && e.message?.id)
        this.assistantMessage(e.message.id)
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        this.streamed = true
        this.text(e.delta.text)
      }
      if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use')
        this.tool({ id: e.content_block.id, title: e.content_block.name, status: 'running' })
    }
    if (m.type === 'assistant') {
      if (m.message?.id)
        this.assistantMessage(m.message.id)
      for (const c of m.message?.content ?? []) {
        if (c.type === 'text' && !this.streamed)
          this.text(c.text)
        if (c.type === 'tool_use')
          this.tool({ id: c.id, title: c.name, status: 'running' })
      }
      this.streamed = false
    }
    if (m.type === 'user') {
      for (const c of m.message?.content ?? []) {
        if (c.type === 'tool_result')
          this.tool({ id: c.tool_use_id, title: this.tools.get(c.tool_use_id)?.title ?? 'Tool', status: c.is_error ? 'failed' : 'completed' })
      }
    }
    if (m.type === 'result') {
      this.usage(m.usage?.input_tokens, m.usage?.output_tokens)
      if (this.turn.cancelled)
        this.finish('cancelled')
      else if (m.is_error)
        this.fail(new Error(m.result ?? m.errors?.join('; ') ?? 'Claude request failed'))
      else
        this.finish()
    }
  }

  protected async send(prompt: DriverPrompt) {
    this.streamed = false
    const command = prompt.command ? this.selectedCommand(prompt) : undefined
    await this.peer.process.write({ type: 'user', session_id: this.sessionId, parent_tool_use_id: null, message: { role: 'user', content: command ? `/${command.nativeName} ${prompt.command!.arguments}` : promptText(prompt) } })
  }

  async cancel() {
    if (!this.turn)
      return
    this.turn.cancelled = true
    await this.dismiss()
    await this.peer.request({ subtype: 'interrupt' })
    // The result message is the native acknowledgement of turn completion.
    await this.waitUntilIdle()
  }

  async close() {
    this.closed = true
    await this.dismiss()
    this.finish('cancelled')
    await this.peer.process.stop()
  }
}
