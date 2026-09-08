import type { AgentMessage } from './message'
import type { AgentSession, AgentTurn } from './session'

export interface StoredSession {
  version: 1
  session: AgentSession
}

/** Durable display records, not provider wire packets or token-level deltas. */
export type StorageEvent
  = | { type: 'message', message: AgentMessage }
    | { type: 'turn', turn: AgentTurn }

export interface StoredEvent {
  version: 1
  sessionId: string
  sequence: number
  timestamp: number
  event: StorageEvent
}
