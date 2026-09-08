import type { ChatProviderId } from './chat'

export interface ComposerCommand {
  id: string
  name: string
  description: string
  kind: 'command' | 'skill'
  source: ChatProviderId | 'application'
  scope: 'builtin' | 'project' | 'user' | 'skill'
  execution: 'local' | 'native' | 'template'
}

export interface ComposerCatalog {
  status: 'ready' | 'pendingSession' | 'unsupported' | 'error'
  commands: ComposerCommand[]
  error?: string
}

export interface ComposerFile { path: string, isDirectory: boolean }
export interface ComposerFiles { files: ComposerFile[], truncated: boolean }
export interface ComposerFileReference { kind?: 'file', path: string, start: number, end: number }
export interface ComposerComponent { scopeId: string, appId: string, id: string, instanceToken: string, name: string, parentPath: string, file?: string }
export interface ComponentSnapshot {
  page: string
  capturedAt: number
  component: { name: string, id: string, parentPath: string, file?: string }
  state: { group: 'props' | 'data' | 'setup', key: string, value: unknown }[]
  truncated: boolean
  skipped: number
}
export interface ComposerComponentReference { kind: 'component', component: ComposerComponent, start: number, end: number, snapshot?: ComponentSnapshot }
export type ComposerReference = ComposerFileReference | ComposerComponentReference
export interface ComposerComponents { scopeId: string, appId: string, components: ComposerComponent[], truncated: boolean }
export interface ComposerComponentTransport {
  pick?: () => Promise<ComposerComponent | null>
  cancelPick?: () => Promise<void>
  capture?: (components: ComposerComponent[]) => Promise<ComponentSnapshot[]>
  list: (query: string) => Promise<ComposerComponents>
  validate: (components: ComposerComponent[]) => Promise<boolean[]>
  highlight: (component: ComposerComponent | null) => Promise<boolean>
}
export interface ComposerSelection { id: string, name: string, kind?: 'command' | 'skill' }
export interface ComposerContext { provider: ChatProviderId, sessionId: string | null }
export interface ComposerTransport {
  components?: ComposerComponentTransport
  commands: (context: ComposerContext, refresh?: boolean) => Promise<ComposerCatalog>
  files: (query: string) => Promise<ComposerFiles>
}
