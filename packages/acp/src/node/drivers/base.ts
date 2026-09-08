import type { ComposerCatalog, DriverControl, DriverEvent, DriverPrompt, DriverStartOptions, PermissionResponse, ProviderCapabilities, SessionOptions, ToolCall, UserInputResponse } from '../../schema'
import type { NativeCommand } from '../composer-commands'
import { randomUUID } from 'node:crypto'
import { publicCatalog } from '../composer-commands'
import { deadline, DriverError } from './process'

export const capabilities = (): ProviderCapabilities => ({ resume: true, listSessions: false, loadHistory: false, changeModel: false, steer: false, permissions: false, userInput: false, mcp: false })
export abstract class BaseDriver implements DriverControl {
  protected commands: NativeCommand[] = []
  protected commandCatalog: ComposerCatalog = { status: 'pendingSession', commands: [] }
  protected publishCommands(commands: NativeCommand[], status: ComposerCatalog['status'] = 'ready') {
    this.commands = commands
    this.commandCatalog = publicCatalog(commands, status)
    this.emit({ type: 'commandsUpdated', catalog: this.commandCatalog })
    return this.commandCatalog
  }

  protected commandDiscoveryFailed(error: unknown) {
    const unsupported = error instanceof Error && /method not found|unknown method|unsupported|not supported|HTTP 404/i.test(error.message)
    this.commands = []
    this.commandCatalog = { status: unsupported ? 'unsupported' : 'error', commands: [], ...(unsupported ? {} : { error: 'Unable to load commands. Refresh to retry.' }) }
    this.emit({ type: 'commandsUpdated', catalog: this.commandCatalog })
    return this.commandCatalog
  }

  async getCommands(_refresh = false): Promise<ComposerCatalog> {
    return this.commandCatalog
  }

  protected selectedCommand(prompt: DriverPrompt) {
    const command = this.commands.find(c => c.id === prompt.command?.id && c.name === prompt.command?.name)
    if (!command)
      throw new DriverError('unsupported', 'Command is no longer available. Refresh commands and try again.')
    return command
  }

  capabilities = capabilities()
  protected turn?: DriverPrompt & {
    assistantId: string
    cancelled: boolean
  }

  protected closed = false
  protected timer?: ReturnType<typeof setTimeout>
  protected permissions = new Map<string, {
    ids: string[]
    reply: (value: PermissionResponse) => Promise<void>
  }>()

  protected tools = new Map<string, ToolCall>()
  private nativeMessageIds = new Map<string, string>()
  private idleWaiters = new Set<() => void>()
  protected questions = new Map<string, (value: UserInputResponse) => Promise<void>>()
  constructor(protected config: DriverStartOptions, protected emit: (event: DriverEvent) => void) { }
  protected abstract send(prompt: DriverPrompt): Promise<void>
  abstract cancel(): Promise<void>
  abstract close(): Promise<void>
  async prompt(prompt: DriverPrompt) {
    if (this.closed)
      throw new DriverError('disconnected', 'Driver is closed')
    if (this.turn)
      throw new DriverError('busy', 'A turn is already active')
    if (!prompt.turnId || !prompt.messageId || !prompt.content.length || prompt.content.some(c => c.type !== 'text'))
      throw new DriverError('unsupported', 'This driver currently accepts nonempty text prompts only')
    if (prompt.command) {
      await this.getCommands(true)
      this.selectedCommand(prompt)
      if (this.closed)
        throw new DriverError('disconnected', 'Driver is closed')
      if (this.turn)
        throw new DriverError('busy', 'A turn is already active')
    }
    this.turn = { ...prompt, assistantId: randomUUID(), cancelled: false }
    this.tools.clear()
    this.nativeMessageIds.clear()
    const command = prompt.command ? this.selectedCommand(prompt) : undefined
    this.emit({ type: 'promptSubmitted', message: { id: prompt.messageId, turnId: prompt.turnId, role: 'user', content: prompt.displayContent ?? prompt.content, createdAt: Date.now(), ...(prompt.references?.length ? { references: prompt.references } : {}), ...(command ? { command: { id: command.id, name: command.name, kind: command.kind } } : {}) } })
    this.emit({ type: 'turnStarted', turnId: prompt.turnId })
    this.timer = setTimeout(() => {
      this.fail(new DriverError('disconnected', 'Agent turn timed out'))
      void this.close()
    }, this.config.turnTimeoutMs ?? 120000)
    try {
      await this.send(prompt)
    }
    catch (error) {
      this.fail(error)
      throw error
    }
  }

  protected assistantMessage(nativeId?: string) {
    if (!this.turn)
      return ''
    if (nativeId) {
      let id = this.nativeMessageIds.get(nativeId)
      if (!id) {
        id = randomUUID()
        this.nativeMessageIds.set(nativeId, id)
      }
      this.turn.assistantId = id
    }
    return this.turn.assistantId
  }

  protected text(text: string, nativeMessageId?: string) {
    if (this.turn && text)
      this.emit({ type: 'textDelta', turnId: this.turn.turnId, messageId: this.assistantMessage(nativeMessageId), text })
  }

  protected tool(tool: ToolCall, nativeMessageId?: string) {
    if (!this.turn)
      return
    const old = this.tools.get(tool.id)
    const next = { ...old, ...tool, turnId: this.turn.turnId, messageId: old?.messageId ?? this.assistantMessage(nativeMessageId) }
    this.tools.set(tool.id, next)
    this.emit({ type: 'toolCallUpdated', turnId: this.turn.turnId, toolCall: next })
  }

  protected finish(reason: 'completed' | 'failed' | 'cancelled' = 'completed') {
    if (!this.turn)
      return
    clearTimeout(this.timer)
    const turn = this.turn
    this.turn = undefined
    for (const resolve of this.idleWaiters)
      resolve()
    this.idleWaiters.clear()
    this.emit({ type: 'turnFinished', turnId: turn.turnId, reason: turn.cancelled ? 'cancelled' : reason })
    void this.dismiss()
  }

  protected fail(error: unknown) {
    this.emit({ type: 'error', error: { code: error instanceof DriverError ? error.code : 'internal', message: error instanceof Error ? error.message : 'Agent failed', retryable: false } })
    this.finish('failed')
  }

  protected async waitUntilIdle() {
    if (!this.turn)
      return
    let resolve!: () => void
    const idle = new Promise<void>((r) => {
      resolve = r
      this.idleWaiters.add(r)
    })
    try {
      await deadline(idle, this.config.requestTimeoutMs)
    }
    catch (error) {
      await this.close()
      throw error
    }
    finally {
      this.idleWaiters.delete(resolve)
    }
  }

  protected usage(input: unknown, output: unknown) {
    if (!this.turn)
      return
    const inputTokens = typeof input === 'number' && Number.isFinite(input) ? input : undefined
    const outputTokens = typeof output === 'number' && Number.isFinite(output) ? output : undefined
    if (inputTokens !== undefined || outputTokens !== undefined)
      this.emit({ type: 'usageUpdated', turnId: this.turn.turnId, ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) })
  }

  protected async dismiss() {
    const pending = [...this.permissions.entries()]
    this.permissions.clear()
    for (const [id, item] of pending)
      await item.reply({ requestId: id, outcome: 'cancelled' }).catch(() => { })
    const questions = [...this.questions.entries()]
    this.questions.clear()
    for (const [id, reply] of questions)
      await reply({ requestId: id, outcome: 'cancelled' }).catch(() => { })
  }

  async respondPermission(response: PermissionResponse) {
    const item = this.permissions.get(response.requestId)
    if (!item || (response.outcome === 'selected' && !item.ids.includes(response.optionId)))
      throw new DriverError('invalidRequest', 'Unknown permission request or option')
    this.permissions.delete(response.requestId)
    await item.reply(response)
  }

  async respondUserInput(response: UserInputResponse) {
    const reply = this.questions.get(response.requestId)
    if (!reply)
      throw new DriverError('unsupported', 'No matching user input request')
    await reply(response)
    this.questions.delete(response.requestId)
  }

  async applyOptions(options: SessionOptions): Promise<'applied' | 'restartRequired'> {
    if (this.turn)
      throw new DriverError('busy', 'Cannot change options during a turn')
    return JSON.stringify(options) === JSON.stringify(this.config.options) ? 'applied' : 'restartRequired'
  }
}
export function promptText(prompt: DriverPrompt) {
  return prompt.content.map(c => c.type === 'text' ? c.text : '').join('\n')
}
