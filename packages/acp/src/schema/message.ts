import type { JsonValue, Timestamp } from './common'
import type { ComposerReference, ComposerSelection } from './composer'

export type MessageContent
  = | { type: 'text', text: string }
    | { type: 'resource', uri: string, name: string, mimeType?: string }

export interface AgentMessage {
  id: string
  turnId: string
  role: 'user' | 'assistant'
  content: MessageContent[]
  createdAt: Timestamp
  references?: ComposerReference[]
  command?: ComposerSelection
  /** Ordered assistant display blocks; content remains the copyable message text. */
  parts?: AgentMessagePart[]
}

export type AgentMessagePart = { type: 'text', text: string } | { type: 'tool', tool: ToolCall }

export interface ToolCall {
  id: string
  turnId?: string
  messageId?: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  input?: JsonValue
  output?: JsonValue
}

export interface PermissionOption {
  id: string
  label: string
  kind: 'allowOnce' | 'allowSession' | 'denyOnce' | 'denySession'
}

export interface PermissionRequest {
  id: string
  toolCallId?: string
  title: string
  detail: string
  options: PermissionOption[]
}

export type PermissionResponse
  = | { requestId: string, outcome: 'selected', optionId: string }
    | { requestId: string, outcome: 'cancelled' }

export interface UserInputQuestion {
  id: string
  prompt: string
  options: { id: string, label: string }[]
  multiple: boolean
  allowText: boolean
}

export interface UserInputRequest {
  id: string
  questions: UserInputQuestion[]
}

export type UserInputResponse
  = | { requestId: string, outcome: 'answered', answers: { questionId: string, optionIds: string[], text?: string }[] }
    | { requestId: string, outcome: 'cancelled' }
