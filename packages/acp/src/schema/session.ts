import type { RuntimeId, SessionId, Timestamp } from './common'
import type { AgentMessage, ToolCall } from './message'
import type { ProviderBinding } from './provider'

export type SessionStatus = 'idle' | 'connecting' | 'working' | 'waiting' | 'background' | 'failed' | 'closed'
export type RuntimeMode = 'ask' | 'acceptEdits' | 'fullAccess'

/** Preferences, not a security boundary; drivers must reject unsupported modes. */
export interface SessionOptions {
  mode: RuntimeMode
  model: string | null
  reasoningEffort: string | null
}

export interface AgentTurn {
  id: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  startedAt: Timestamp
  finishedAt: Timestamp | null
  toolCalls: ToolCall[]
}

export interface ReplayCursor {
  sessionId: SessionId
  runtimeId: RuntimeId
  /** Changes on service restart. Sequence is monotonic within this runtime and epoch. */
  epoch: string
  sequence: number
}

/** Daemon-owned listing record. Once messages exist, provider is immutable. */
export type AgentSession = ProviderBinding & {
  id: SessionId
  title: string
  cwd: string
  options: SessionOptions
  status: SessionStatus
  createdAt: Timestamp
  updatedAt: Timestamp
  lastReplyAt: Timestamp | null
}

/** Display projection only; native provider history owns continuation context. */
export interface SessionHistory {
  messages: AgentMessage[]
  turns: AgentTurn[]
  cursor: ReplayCursor | null
}

/** Ephemeral binding; a page reload requires explicit target revalidation. */
export interface DevToolsTarget {
  connectionId: string
  appId: string
  origin: string
}
