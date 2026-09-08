import type { AgentMessage, AgentTurn, DriverEvent, ToolCall } from '../schema'

type AssistantEvent = Extract<DriverEvent, { type: 'textDelta' | 'toolCallUpdated' }>

export function applyAssistantEvent(messages: Map<string, AgentMessage>, event: AssistantEvent): AgentMessage {
  const messageId = event.type === 'textDelta' ? event.messageId : event.toolCall.messageId ?? `tools:${event.turnId}`
  let message = messages.get(messageId)
  if (!message) {
    message = { id: messageId, turnId: event.turnId, role: 'assistant', content: [], parts: [], createdAt: Date.now() }
    messages.set(messageId, message)
  }
  const parts = message.parts ??= message.content.flatMap(part => part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [])
  if (event.type === 'textDelta') {
    let content = message.content.find(part => part.type === 'text')
    if (!content) {
      content = { type: 'text', text: '' }
      message.content.push(content)
    }
    content.text += event.text
    const last = parts[parts.length - 1]
    if (last?.type === 'text')
      last.text += event.text
    else
      parts.push({ type: 'text', text: event.text })
  }
  else {
    const existing = parts.find(part => part.type === 'tool' && part.tool.id === event.toolCall.id)
    const tool = { ...event.toolCall, turnId: event.turnId, messageId }
    if (existing?.type === 'tool')
      existing.tool = { ...existing.tool, ...tool }
    else
      parts.push({ type: 'tool', tool })
  }
  return message
}

/** Legacy logs retain turn ownership, but not the original text/tool interleaving. */
export function restoreToolMessages(messages: AgentMessage[], turns: AgentTurn[]) {
  for (const turn of turns) {
    for (const raw of turn.toolCalls) {
      let message = raw.messageId ? messages.find(m => m.id === raw.messageId && m.turnId === turn.id && m.role === 'assistant') : undefined
      if (!raw.messageId)
        message ??= messages.find(m => m.turnId === turn.id && m.role === 'assistant')
      if (!message) {
        message = { id: raw.messageId ?? `tools:${turn.id}`, turnId: turn.id, role: 'assistant', content: [], parts: [], createdAt: turn.startedAt }
        const sameTurn = messages.map(m => m.turnId).lastIndexOf(turn.id)
        const later = messages.findIndex(m => m.createdAt > turn.startedAt)
        messages.splice(sameTurn >= 0 ? sameTurn + 1 : later >= 0 ? later : messages.length, 0, message)
      }
      message.parts ??= message.content.flatMap(part => part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [])
      const existing = message.parts.find(part => part.type === 'tool' && part.tool.id === raw.id)
      const tool: ToolCall = { ...raw, turnId: turn.id, messageId: message.id }
      if (existing?.type === 'tool') {
        existing.tool = tool
      }
      else {
        const textAt = message.parts.findIndex(part => part.type === 'text')
        message.parts.splice(textAt < 0 ? message.parts.length : textAt, 0, { type: 'tool', tool })
      }
    }
  }
  return messages
}
