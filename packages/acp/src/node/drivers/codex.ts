import type { DriverPrompt } from '../../schema'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { codexSkills } from '../composer-commands'
import { BaseDriver, promptText } from './base'
import { codexCliEnvironment, codexCliHome } from './codex-home'
import { AgentProcess, DriverError, JsonPeer } from './process'

export class CodexDriver extends BaseDriver {
  private peer?: JsonPeer
  private threadId = ''
  private nativeTurnId = ''
  private streamed = new Set<string>()
  async initialize() {
    if (this.config.options.mode !== 'ask')
      throw new DriverError('unsupported', 'Codex exposes supervised mode only')
    const home = codexCliHome()
    const config = parse(await readFile(join(home, 'config.toml'), 'utf8')) as any
    if (!config.model_provider || config.model_providers?.[config.model_provider]?.wire_api !== 'responses')
      throw new DriverError('invalidRequest', 'Configure Responses in the isolated Codex CLI home')
    const env = codexCliEnvironment()
    this.peer = new JsonPeer(new AgentProcess(this.config.binaryPath ?? 'codex', ['app-server', '--listen', 'stdio://'], this.config.cwd, env), 'codex', this.config.requestTimeoutMs)
    this.peer.onMessage = m => this.receive(m)
    this.peer.process.exitListeners.add((exitCode) => {
      if (!this.closed)
        this.fail(new DriverError('disconnected', 'Codex CLI exited'))
      this.emit({ type: 'processExited', exitCode })
    })
    await this.peer.request({ method: 'initialize', params: { clientInfo: { name: 'vue_devtools', version: '8.2.1' }, capabilities: { experimentalApi: true } } })
    await this.peer.process.write({ method: 'initialized', params: {} })
    const cursor = this.config.providerCursor
    if (cursor && cursor.provider !== 'codex')
      throw new DriverError('resumeFailed', 'Invalid Codex cursor')
    const result = await this.peer.request({ method: cursor ? 'thread/resume' : 'thread/start', params: {
      ...(cursor ? { threadId: cursor.threadId } : {}),
      cwd: this.config.cwd,
      modelProvider: config.model_provider,
      model: this.config.options.model ?? config.model,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    } })
    if (!result?.thread?.id || (cursor && result.thread.id !== cursor.threadId))
      throw new DriverError('resumeFailed', 'Codex did not return the requested thread')
    if (result.thread.cwd && await realpath(result.thread.cwd) !== await realpath(this.config.cwd))
      throw new DriverError('resumeFailed', 'Codex thread belongs to another project')
    this.threadId = result.thread.id
    this.capabilities.permissions = true
    this.capabilities.userInput = true
    this.emit({ type: 'connected', providerCursor: { provider: 'codex', threadId: this.threadId }, capabilities: this.capabilities })
    await this.getCommands(true)
  }

  async getCommands(refresh = false) {
    if (!refresh && this.commandCatalog.status !== 'pendingSession')
      return this.commandCatalog
    try {
      const cwd = await realpath(this.config.cwd)
      const result = await this.peer!.request({ method: 'skills/list', params: { cwds: [cwd], forceReload: refresh } }, false)
      return this.publishCommands(codexSkills(result, cwd))
    }
    catch (error) { return this.commandDiscoveryFailed(error) }
  }

  private async reply(id: string | number, result: unknown) {
    await this.peer!.process.write({ id, result })
  }

  private receive(m: any) {
    const p = m.params ?? {}
    if (m.method && m.id != null) {
      const requestId = String(m.id)
      if (!this.turn || p.threadId !== this.threadId) {
        void this.peer!.process.write({ id: m.id, error: { code: -32601, message: 'Unsupported request' } }).catch(() => {})
        return
      }
      if (m.method === 'item/tool/requestUserInput') {
        const questions = (p.questions ?? []).map((q: any) => ({ id: q.id, prompt: q.question, options: (q.options ?? []).map((o: any) => ({ id: o.label, label: o.label })), multiple: false, allowText: true }))
        this.questions.set(requestId, async (r) => {
          if (r.outcome === 'cancelled') {
            await this.reply(m.id, { answers: {} })
            return
          }
          const answers: Record<string, { answers: string[] }> = {}
          for (const a of r.answers) {
            if (!questions.some((q: any) => q.id === a.questionId))
              throw new DriverError('invalidRequest', 'Unknown question')
            answers[a.questionId] = { answers: [...a.optionIds, ...(a.text ? [a.text] : [])] }
          }
          await this.reply(m.id, { answers })
        })
        this.emit({ type: 'userInputRequested', turnId: this.turn.turnId, request: { id: requestId, questions } })
      }
      else if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(m.method)) {
        this.permissions.set(requestId, { ids: ['accept', 'decline'], reply: async r => this.reply(m.id, { decision: r.outcome === 'selected' ? r.optionId : 'decline' }) })
        this.emit({ type: 'permissionRequested', turnId: this.turn.turnId, request: { id: requestId, title: m.method.includes('fileChange') ? 'Apply file changes' : 'Run command', detail: p.command ?? p.reason ?? '', options: [{ id: 'accept', label: 'Allow once', kind: 'allowOnce' }, { id: 'decline', label: 'Deny', kind: 'denyOnce' }] } })
      }
      else {
        void this.peer!.process.write({ id: m.id, error: { code: -32601, message: 'Unsupported request' } }).catch(() => {})
      }
      return
    }
    if (!this.turn || p.threadId !== this.threadId)
      return
    if (m.method === 'turn/started')
      this.nativeTurnId = p.turn.id
    if (m.method === 'item/agentMessage/delta') {
      this.streamed.add(p.itemId)
      this.text(p.delta, p.itemId)
    }
    if (m.method === 'item/started' || m.method === 'item/completed') {
      const item = p.item
      if (item?.type === 'agentMessage' && m.method === 'item/started')
        this.assistantMessage(item.id)
      if (item?.type === 'agentMessage' && m.method === 'item/completed' && !this.streamed.has(item.id))
        this.text(item.text ?? '', item.id)
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(item?.type))
        this.tool({ id: item.id, title: item.command ?? item.tool ?? item.type, status: m.method === 'item/started' ? 'running' : ['failed', 'declined'].includes(item.status) ? 'failed' : 'completed' })
    }
    if (m.method === 'thread/tokenUsage/updated')
      this.usage(p.tokenUsage?.last?.inputTokens, p.tokenUsage?.last?.outputTokens)
    if (m.method === 'turn/completed') {
      if (this.turn.cancelled || p.turn.status === 'interrupted')
        this.finish('cancelled')
      else if (p.turn.status === 'failed')
        this.fail(new Error(p.turn.error?.message ?? 'Codex inference failed'))
      else this.finish()
    }
    if (m.method === 'error' && !p.willRetry)
      this.fail(new Error(p.error?.message ?? 'Codex request failed'))
  }

  protected async send(prompt: DriverPrompt) {
    this.streamed.clear()
    this.nativeTurnId = ''
    const skill = prompt.command ? this.selectedCommand(prompt) : undefined
    const input: unknown[] = [{ type: 'text', text: skill ? prompt.command!.arguments : promptText(prompt), text_elements: [] }]
    if (skill)
      input.push({ type: 'skill', name: skill.nativeName, path: skill.path })
    const result = await this.peer!.request({ method: 'turn/start', params: { threadId: this.threadId, input, ...(this.config.options.model ? { model: this.config.options.model } : {}), ...(this.config.options.reasoningEffort ? { effort: this.config.options.reasoningEffort } : {}) } })
    this.nativeTurnId = result.turn.id
  }

  async cancel() {
    if (!this.turn)
      return
    this.turn.cancelled = true
    await this.dismiss()
    if (!this.nativeTurnId) {
      await this.close()
      return
    }
    await this.peer!.request({ method: 'turn/interrupt', params: { threadId: this.threadId, turnId: this.nativeTurnId } })
    await this.waitUntilIdle()
  }

  async close() {
    this.closed = true
    await this.dismiss()
    this.finish('cancelled')
    await this.peer?.process.stop()
  }
}
