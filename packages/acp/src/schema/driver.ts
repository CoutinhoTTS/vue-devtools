import type { ComposerCatalog, ComposerReference } from './composer'
import type { DriverEvent } from './events'
import type { MessageContent, PermissionResponse, UserInputResponse } from './message'
import type { ProviderBinding, ProviderCapabilities } from './provider'
import type { SessionOptions } from './session'

/** Resolved on the service host, never accepted as an arbitrary browser command. */
export type DriverStartOptions = ProviderBinding & {
  binaryPath?: string
  cwd: string
  options: SessionOptions
  requestTimeoutMs?: number
  turnTimeoutMs?: number
}

export interface DriverPrompt {
  turnId: string
  messageId: string
  content: MessageContent[]
  displayContent?: MessageContent[]
  references?: ComposerReference[]
  command?: { id: string, name: string, arguments: string }
}

/** Service-only interface. This contract is not a serializable wire message. */
export interface DriverControl {
  capabilities: ProviderCapabilities
  getCommands?: (refresh?: boolean) => Promise<ComposerCatalog>
  prompt: (prompt: DriverPrompt) => Promise<void>
  cancel: () => Promise<void>
  respondPermission: (response: PermissionResponse) => Promise<void>
  respondUserInput: (response: UserInputResponse) => Promise<void>
  applyOptions: (options: SessionOptions) => Promise<'applied' | 'restartRequired'>
  steer?: (content: MessageContent[]) => Promise<void>
  close: () => Promise<void>
}

export interface DriverFactory {
  start: (options: DriverStartOptions, emit: (event: DriverEvent) => void) => Promise<DriverControl>
}
