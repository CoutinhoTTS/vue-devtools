import type { AgentChatTransport, ComposerComponentTransport, ComposerTransport } from '../schema'
import type { CatalogTransport } from './useAgentCatalog'

type Authenticated<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (token: string, ...args: A) => R : never
}

export interface AcpHost {
  chat: Authenticated<AgentChatTransport>
  catalog: CatalogTransport
  composer: Authenticated<Pick<ComposerTransport, 'commands' | 'files'>>
  components?: Omit<ComposerComponentTransport, 'highlight'> & {
    highlight: (component: Parameters<ComposerComponentTransport['highlight']>[0], clientId: string, sequence: number) => Promise<boolean>
  }
}

export interface AcpTransport {
  connect: () => Promise<void>
  chat: AgentChatTransport
  catalog: CatalogTransport
  composer: ComposerTransport
}

export async function authorizeAgent(): Promise<string> {
  const base = location.pathname.split('/__devtools__')[0]
  const response = await fetch(`${base}/__vue_devtools_agent_auth`, { method: 'POST', headers: { 'X-Vue-Devtools-Agent': '1' }, signal: AbortSignal.timeout(5000) })
  if (!response.ok)
    throw new Error('Agent access requires the local Vite server. Restart play if it has not loaded the new chat endpoints.')
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || !('token' in result) || typeof result.token !== 'string' || !result.token)
    throw new Error('Agent authorization unavailable')
  return result.token
}

export function createAcpTransport(host: AcpHost, authorize = authorizeAgent): AcpTransport {
  let token = ''
  const componentClientId = crypto.randomUUID()
  let componentSequence = 0
  const components = host.components
  return {
    async connect() {
      token = await authorize()
    },
    chat: {
      list: () => host.chat.list(token),
      send: input => host.chat.send(token, input),
      stop: id => host.chat.stop(token, id),
      permission: (id, response) => host.chat.permission(token, id, response),
      answer: (id, response) => host.chat.answer(token, id, response),
      options: (id, options) => host.chat.options(token, id, options),
    },
    catalog: host.catalog,
    composer: {
      commands: (context, refresh) => host.composer.commands(token, context, refresh),
      files: query => host.composer.files(token, query),
      components: components && {
        pick: components.pick && (() => components.pick!()),
        cancelPick: components.cancelPick && (() => components.cancelPick!()),
        capture: components.capture && (values => components.capture!(values)),
        list: query => components.list(query),
        validate: values => components.validate(values),
        highlight: component => components.highlight(component, componentClientId, ++componentSequence),
      },
    },
  }
}
