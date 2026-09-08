import type { AgentMessage, AgentSession, ComposerCatalog, ComposerReference, ComposerSelection, PermissionRequest, ProviderModel, SessionOptions, ToolCall, UserInputRequest } from '../schema'

export type ChatAgent = 'kimi' | 'grok' | 'claude' | 'pi' | 'openCode' | 'codex'
export const chatAgents: { value: ChatAgent, label: string }[] = [
  { value: 'codex', label: 'Codex CLI' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'grok', label: 'Grok' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'pi', label: 'Pi' },
  { value: 'openCode', label: 'OpenCode' },
]
export function agentLabel(provider: string) {
  return chatAgents.find(agent => agent.value === provider)?.label ?? provider
}
export interface ChatProvider {
  id: ChatAgent
  installed?: boolean
  refreshing?: boolean
  error?: string
  models?: ProviderModel[]
  modelControl: 'available' | 'unsupported' | 'loading'
  effortControl: 'available' | 'unsupported' | 'loading'
}
export interface ChatMessage extends AgentMessage {
  streaming?: boolean
  delivery?: 'sending' | 'failed'
}
export interface ChatSession {
  commands?: ComposerCatalog
  id: string
  title: string
  provider: ChatAgent
  options: SessionOptions
  status: AgentSession['status']
  messages: ChatMessage[]
  tools?: ToolCall[]
  error?: string
  optionsPending?: boolean
  optionsError?: string
  permission?: PermissionRequest
  question?: UserInputRequest
  requestPending?: boolean
  requestError?: string
}
export interface ChatSelection { provider: ChatAgent, options: SessionOptions }
export interface ChatSend extends ChatSelection { sessionId: string | null, content: string, references?: ComposerReference[], command?: ComposerSelection }
export function isRunning(status?: ChatSession['status']) {
  return !!status && ['connecting', 'working', 'waiting', 'background'].includes(status)
}
export function defaultSelection(): ChatSelection {
  return { provider: 'kimi', options: { model: null, reasoningEffort: null, mode: 'ask' } }
}
