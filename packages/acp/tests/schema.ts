import type { ClientMessage, DriverEvent, ProviderBinding, ServerResponse } from '../src'

export const codex = {
  provider: 'codex',
  providerCursor: { provider: 'codex', threadId: 'native-thread' },
} satisfies ProviderBinding

export const draft = { provider: 'claude', providerCursor: null } satisfies ProviderBinding

// @ts-expect-error A Claude cursor cannot resume a Codex session.
export const wrongProvider: ProviderBinding = { provider: 'codex', providerCursor: { provider: 'claude', sessionId: 'native-session' } }

// @ts-expect-error Codex resumes by threadId, not sessionId.
export const wrongCursor: ProviderBinding = { provider: 'codex', providerCursor: { provider: 'codex', sessionId: 'native-thread' } }

export const request = {
  type: 'request',
  requestId: 'request-1',
  method: 'attachSession',
  params: { sessionId: 'session-1' },
} satisfies ClientMessage

// @ts-expect-error Cancellation needs a runtime ID and epoch, not only a session.
export const unsafeCancel: ClientMessage = { type: 'request', requestId: 'request-2', method: 'cancel', params: { sessionId: 'session-1' } }

// @ts-expect-error The result must match the method.
export const wrongResult: ServerResponse = { type: 'response', requestId: 'request-3', method: 'listSessions', ok: true, result: null }

// @ts-expect-error Text deltas must identify both turn and message.
export const missingMessage: DriverEvent = { type: 'textDelta', turnId: 'turn-1', text: 'Hello' }

export function responseCount(response: ServerResponse): number {
  if (response.method === 'listSessions' && response.ok)
    return response.result.length
  return 0
}
