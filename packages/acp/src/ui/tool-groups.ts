import type { AgentMessagePart, ToolCall } from '../schema'

export type MessageDisplayPart = { key: string, type: 'text', text: string } | { key: string, type: 'tools', tools: ToolCall[] }

/** Only adjacent calls are grouped, keeping intervening text in its original position. */
export function groupMessageTools(parts: AgentMessagePart[]): MessageDisplayPart[] {
  const result: MessageDisplayPart[] = []
  parts.forEach((part, index) => {
    if (part.type === 'text') {
      result.push({ key: `text:${index}`, type: 'text', text: part.text })
      return
    }
    const previous = result[result.length - 1]
    if (previous?.type === 'tools')
      previous.tools.push(part.tool)
    else
      result.push({ key: `tools:${part.tool.id}`, type: 'tools', tools: [part.tool] })
  })
  return result
}

export function toolGroupStatus(tools: ToolCall[]): ToolCall['status'] {
  for (const status of ['running', 'pending', 'failed', 'cancelled'] as const) {
    if (tools.some(tool => tool.status === status))
      return status
  }
  return 'completed'
}
