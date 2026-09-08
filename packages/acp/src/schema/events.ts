import type { ProtocolError } from './common'
import type { ComposerCatalog } from './composer'
import type { AgentMessage, PermissionRequest, ToolCall, UserInputRequest } from './message'
import type { ProviderCapabilities, ProviderResumeCursor } from './provider'
import type { ReplayCursor } from './session'

export type DriverEvent
  = | { type: 'connected', providerCursor: ProviderResumeCursor, capabilities: ProviderCapabilities }
    | { type: 'commandsUpdated', catalog: ComposerCatalog }
    | { type: 'promptSubmitted', message: AgentMessage }
    | { type: 'turnStarted', turnId: string }
    | { type: 'textDelta', turnId: string, messageId: string, text: string }
    | { type: 'toolCallUpdated', turnId: string, toolCall: ToolCall }
    | { type: 'permissionRequested', turnId: string, request: PermissionRequest }
    | { type: 'userInputRequested', turnId: string, request: UserInputRequest }
    | { type: 'titleUpdated', title: string }
    | { type: 'usageUpdated', turnId: string, inputTokens?: number, outputTokens?: number, contextTokens?: number, contextWindow?: number }
    | { type: 'turnFinished', turnId: string, reason: 'completed' | 'cancelled' | 'failed', summary?: string }
    | { type: 'error', error: ProtocolError }
    | { type: 'processExited', exitCode: number | null }

export interface SequencedEvent extends ReplayCursor {
  event: DriverEvent
}
