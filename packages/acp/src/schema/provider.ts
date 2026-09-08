export type ProviderKind = 'claude' | 'codex' | 'fx' | 'grok' | 'kimi' | 'openCode' | 'amp' | 'pi' | 'ohMyPi' | 'deepSeek'
export type ProviderTransport = 'acp' | 'codexAppServer' | 'claudeStreamJson' | 'native'

/** Reported by a driver after discovery; declaring a kind does not implement it. */
export interface ProviderCapabilities {
  resume: boolean
  listSessions: boolean
  loadHistory: boolean
  changeModel: boolean
  steer: boolean
  permissions: boolean
  userInput: boolean
  mcp: boolean
}

export interface ProviderModel {
  id: string
  name: string
  isDefault: boolean
  reasoningEfforts: string[]
}

export interface ProviderProbe {
  provider: ProviderKind
  transport: ProviderTransport
  installed: boolean
  binaryPath: string | null
  version: string | null
  authentication: 'unknown' | 'required' | 'authenticated'
  models: ProviderModel[]
  capabilities: ProviderCapabilities | null
}

/** Native cursors are opaque to the UI; only their matching driver interprets them. */
export interface ProviderCursorMap {
  claude: { sessionId: string, resumeAt?: string }
  codex: { threadId: string }
  fx: { sessionId: string }
  grok: { sessionId: string }
  kimi: { sessionId: string }
  openCode: { sessionId: string }
  amp: { threadId: string }
  pi: { sessionId: string, sessionFile?: string }
  ohMyPi: { sessionId: string, sessionFile?: string }
  deepSeek: { sessionId: string }
}

export type ProviderResumeCursor<P extends ProviderKind = ProviderKind> = {
  [K in P]: { provider: K } & ProviderCursorMap[K]
}[P]

export type ProviderBinding = {
  [K in ProviderKind]: {
    provider: K
    providerCursor: ProviderResumeCursor<K> | null
  }
}[ProviderKind]
