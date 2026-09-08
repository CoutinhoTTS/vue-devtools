import type { AgentSession, StorageEvent, StoredEvent, StoredSession } from '../../schema'
import { validateComponentContext } from '../../schema/component-context'

export function record(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid storage object')
}

function check(condition: boolean): asserts condition {
  if (!condition)
    throw new Error('Invalid session storage data')
}

const text = (v: unknown): v is string => typeof v === 'string'
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const nullableText = (v: unknown) => v === null || text(v)
function validateTool(tool: unknown) {
  record(tool)
  check(text(tool.id) && text(tool.title) && ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(tool.status))
  check(tool.turnId === undefined || text(tool.turnId))
  check(tool.messageId === undefined || text(tool.messageId))
}

export function validateSession(value: unknown): asserts value is AgentSession {
  record(value)
  check(text(value.id) && text(value.title) && text(value.cwd))
  check(['claude', 'codex', 'fx', 'grok', 'kimi', 'openCode', 'amp', 'pi', 'ohMyPi', 'deepSeek'].includes(value.provider))
  if (value.providerCursor !== null) {
    record(value.providerCursor)
    check(value.providerCursor.provider === value.provider)
    const key = ['codex', 'amp'].includes(value.provider) ? 'threadId' : 'sessionId'
    check(text(value.providerCursor[key]) && value.providerCursor[key].length > 0)
    for (const optional of ['resumeAt', 'sessionFile']) {
      check(value.providerCursor[optional] === undefined || text(value.providerCursor[optional]))
    }
  }
  record(value.options)
  check(['ask', 'acceptEdits', 'fullAccess'].includes(value.options.mode))
  check(nullableText(value.options.model) && nullableText(value.options.reasoningEffort))
  check(['idle', 'connecting', 'working', 'waiting', 'background', 'failed', 'closed'].includes(value.status))
  check(time(value.createdAt) && time(value.updatedAt) && (value.lastReplyAt === null || time(value.lastReplyAt)))
}

export function validateStoredSession(value: unknown): asserts value is StoredSession {
  record(value)
  check(value.version === 1)
  validateSession(value.session)
}

export function validateEvent(value: unknown): asserts value is StorageEvent {
  record(value)
  if (value.type === 'message') {
    const m = value.message
    record(m)
    check(text(m.id) && text(m.turnId) && ['user', 'assistant'].includes(m.role) && time(m.createdAt))
    check(Array.isArray(m.content))
    if (m.parts !== undefined) {
      check(m.role === 'assistant' && Array.isArray(m.parts))
      for (const part of m.parts) {
        record(part)
        if (part.type === 'tool')
          validateTool(part.tool)
        else
          check(part.type === 'text' && text(part.text))
      }
    }
    if (m.command !== undefined) {
      record(m.command)
      check(text(m.command.id) && text(m.command.name) && (m.command.kind === undefined || ['command', 'skill'].includes(m.command.kind)))
    }
    if (m.references !== undefined) {
      check(Array.isArray(m.references) && m.references.length <= 100)
      for (const reference of m.references) {
        record(reference)
        if (reference.kind === 'component') {
          validateComponentContext(reference as import('../../schema').ComposerComponentReference)
          continue
        }
        check(text(reference.path) && time(reference.start) && time(reference.end) && reference.end > reference.start)
      }
    }
    for (const c of m.content) {
      record(c)
      check(c.type === 'text' ? text(c.text) : c.type === 'resource' && text(c.uri) && text(c.name) && (c.mimeType === undefined || text(c.mimeType)))
    }
  }
  else if (value.type === 'turn') {
    const t = value.turn
    record(t)
    check(text(t.id) && ['running', 'completed', 'cancelled', 'failed'].includes(t.status))
    check(time(t.startedAt) && (t.finishedAt === null || time(t.finishedAt)) && Array.isArray(t.toolCalls))
    for (const tool of t.toolCalls) {
      validateTool(tool)
    }
  }
  else {
    throw new Error('Unknown storage event type')
  }
}

export function validateStoredEvent(value: unknown): asserts value is StoredEvent {
  record(value)
  check(value.version === 1 && text(value.sessionId) && time(value.sequence) && value.sequence > 0 && time(value.timestamp))
  validateEvent(value.event)
}
