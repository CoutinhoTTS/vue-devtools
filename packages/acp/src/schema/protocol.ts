import type { ProtocolError, RequestId, RuntimeId, SessionId } from './common'
import type { SequencedEvent } from './events'
import type { MessageContent, PermissionResponse, UserInputResponse } from './message'
import type { ProviderBinding, ProviderKind, ProviderProbe } from './provider'
import type { AgentSession, DevToolsTarget, ReplayCursor, SessionHistory, SessionOptions } from './session'

/** Our browser/service contract version, independent of ACP's protocol version. */
export type ProtocolVersion = 1

export interface RuntimeHandle {
  sessionId: SessionId
  runtimeId: RuntimeId
  epoch: string
}

export interface RequestContract {
  listProviders: { params: Record<string, never>, result: ProviderProbe[] }
  probeProvider: { params: { provider: ProviderKind }, result: ProviderProbe }
  listSessions: { params: { cwd?: string }, result: AgentSession[] }
  createSession: { params: ProviderBinding & { cwd: string, options: SessionOptions }, result: AgentSession }
  loadSession: { params: { sessionId: SessionId }, result: { session: AgentSession, history: SessionHistory } }
  /** Observes an existing process without starting or replacing it. */
  attachSession: { params: { sessionId: SessionId }, result: RuntimeHandle | null }
  startSession: { params: { sessionId: SessionId }, result: RuntimeHandle }
  prompt: { params: RuntimeHandle & { turnId: string, messageId: string, content: MessageContent[] }, result: null }
  cancel: { params: RuntimeHandle, result: null }
  respondPermission: { params: RuntimeHandle & { response: PermissionResponse }, result: null }
  respondUserInput: { params: RuntimeHandle & { response: UserInputResponse }, result: null }
  applyOptions: { params: RuntimeHandle & { options: SessionOptions }, result: { outcome: 'applied' | 'restartRequired' } }
  bindTarget: { params: { sessionId: SessionId, target: DevToolsTarget | null }, result: null }
  closeSession: { params: RuntimeHandle, result: null }
}

export type RequestMethod = keyof RequestContract

export type ClientRequest = {
  [K in RequestMethod]: {
    type: 'request'
    requestId: RequestId
    method: K
    params: RequestContract[K]['params']
  }
}[RequestMethod]

export type ServerResponse = {
  [K in RequestMethod]: { type: 'response', requestId: RequestId, method: K } & (
    | { ok: true, result: RequestContract[K]['result'] }
    | { ok: false, error: ProtocolError }
  )
}[RequestMethod]

export type ClientMessage
  = | { type: 'hello', protocolVersion: ProtocolVersion, clientId: string, token: string, resumeFrom: ReplayCursor[] }
    | ClientRequest

export type ServerMessage
  = | { type: 'hello', protocolVersion: ProtocolVersion, epoch: string }
    | { type: 'event', data: SequencedEvent }
    | { type: 'replayUnavailable', sessionId: SessionId }
    | { type: 'error', error: ProtocolError }
    | ServerResponse
