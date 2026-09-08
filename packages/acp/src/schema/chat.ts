import type { ComposerCatalog, ComposerReference, ComposerSelection } from './composer'
import type { AgentMessage, PermissionRequest, PermissionResponse, ToolCall, UserInputRequest, UserInputResponse } from './message'
import type { SessionOptions, SessionStatus } from './session'

export type ChatProviderId = 'kimi' | 'grok' | 'claude' | 'pi' | 'openCode' | 'codex'
export interface AgentChatSession {
  id: string
  title: string
  provider: ChatProviderId
  options: SessionOptions
  status: SessionStatus
  messages: (AgentMessage & { streaming?: boolean })[]
  /** Compatibility snapshot; message.parts determines tool placement in the transcript. */
  tools: ToolCall[]
  permission?: PermissionRequest
  question?: UserInputRequest
  error?: string
  commands?: ComposerCatalog
}
export interface AgentChatSend {
  requestId: string
  sessionId: string | null
  provider: ChatProviderId
  options: SessionOptions
  content: string
  command?: ComposerSelection
  references?: ComposerReference[]
}
export interface AgentChatTransport {
  list: () => Promise<AgentChatSession[]>
  send: (input: AgentChatSend) => Promise<{ sessionId: string }>
  stop: (id: string) => Promise<void>
  permission: (id: string, response: PermissionResponse) => Promise<void>
  answer: (id: string, response: UserInputResponse) => Promise<void>
  options: (id: string, options: SessionOptions) => Promise<void>
}
