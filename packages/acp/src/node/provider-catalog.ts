import type { ProviderModel } from '../schema'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parse as parseJson } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { codexCliHome } from './drivers/codex-home'
import { DriverError } from './drivers/process'

export const supportedAgents = ['kimi', 'grok', 'claude', 'pi', 'openCode', 'codex'] as const
export type CatalogAgent = typeof supportedAgents[number]
export interface AgentCatalog {
  provider: CatalogAgent
  installed: boolean
  models: ProviderModel[]
  source?: string
  error?: string
}
interface Gateway {
  url: string
  key: string
  defaultId?: string
  nativeId: (id: string) => string
}
const commands: Record<CatalogAgent, string> = { kimi: 'kimi', grok: 'grok', claude: 'claude', pi: 'pi', openCode: 'opencode', codex: 'codex' }
async function config(path: string, toml = false): Promise<any> {
  const content = await readFile(path, 'utf8')
  if (toml)
    return parseToml(content)
  const errors: import('jsonc-parser').ParseError[] = []
  const value = parseJson(content, errors, { allowTrailingComma: true })
  if (errors.length)
    throw new Error('Invalid CLI configuration')
  return value
}
function credential(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('!'))
    throw new Error('Missing static credentials')
  const variable = value.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/)
  const key = variable ? process.env[variable[1]] : value
  if (!key)
    throw new Error('Missing credential environment variable')
  return key
}
export function modelsUrl(base: string): string {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid gateway URL')
  let path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages)$/, '')
  if (!path)
    path = '/v1'
  url.pathname = `${path}/models`
  return url.href
}
/** Read only the active user-configured provider. No default public endpoints. */
async function gateway(provider: CatalogAgent, home: string): Promise<Gateway> {
  if (provider === 'codex') {
    const d = await config(join(codexCliHome(home), 'config.toml'), true)
    const p = d.model_providers?.[d.model_provider]
    return { url: modelsUrl(p?.base_url), key: credential(p?.experimental_bearer_token ?? process.env[p?.env_key]), defaultId: d.model, nativeId: id => id }
  }
  if (provider === 'claude') {
    const d = await config(join(process.env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json'))
    const env = { ...d.env, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) }
    return { url: modelsUrl(env.ANTHROPIC_BASE_URL), key: credential(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY), defaultId: env.ANTHROPIC_MODEL ?? d.model, nativeId: id => id }
  }
  if (provider === 'kimi') {
    const d = await config(join(process.env.KIMI_CODE_HOME ?? join(home, '.kimi-code'), 'config.toml'), true)
    const selected = d.models?.[d.default_model]
    const p = d.providers?.[selected?.provider]
    return { url: modelsUrl(p?.base_url), key: credential(p?.api_key ?? p?.env?.OPENAI_API_KEY), defaultId: selected?.model, nativeId: id => Object.keys(d.models ?? {}).find(alias => d.models[alias].provider === selected.provider && d.models[alias].model === id) ?? id }
  }
  if (provider === 'grok') {
    const d = await config(join(process.env.GROK_HOME ?? join(home, '.grok'), 'config.toml'), true)
    const selected = d.model?.[d.models?.default]
    return { url: modelsUrl(selected?.base_url), key: credential(selected?.api_key ?? process.env[selected?.env_key]), defaultId: selected?.model, nativeId: id => Object.keys(d.model ?? {}).find(alias => d.model[alias].model === id && d.model[alias].base_url === selected.base_url) ?? id }
  }
  if (provider === 'pi') {
    const dir = process.env.PI_CODING_AGENT_DIR ?? join(home, '.pi/agent')
    const settings = await config(join(dir, 'settings.json'))
    const d = await config(join(dir, 'models.json'))
    const p = d.providers?.[settings.defaultProvider]
    return { url: modelsUrl(p?.baseUrl), key: credential(p?.apiKey), defaultId: settings.defaultModel, nativeId: id => `${settings.defaultProvider}/${id}` }
  }
  const d = await config(process.env.OPENCODE_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode/opencode.json'))
  const slash = d.model?.indexOf('/') ?? -1
  if (slash < 1)
    throw new Error('No active OpenCode provider')
  const name = d.model.slice(0, slash)
  const p = d.provider?.[name]
  let key = p?.options?.apiKey
  if (typeof key === 'string' && /^\{env:[^}]+\}$/.test(key))
    key = process.env[key.slice(5, -1)]
  return { url: modelsUrl(p?.options?.baseURL), key: credential(key), defaultId: d.model.slice(slash + 1), nativeId: id => `${name}/${id}` }
}
export function parseGatewayModels(data: unknown, mapping: Pick<Gateway, 'nativeId' | 'defaultId'>): ProviderModel[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).data))
    throw new Error('Invalid models response')
  const models = new Map<string, ProviderModel>()
  for (const entry of (data as any).data) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim())
      continue
    const efforts = Array.isArray(entry.reasoning_efforts) ? entry.reasoning_efforts.filter((e: unknown): e is string => typeof e === 'string') : []
    models.set(entry.id, { id: mapping.nativeId(entry.id), name: entry.id, isDefault: entry.id === mapping.defaultId, reasoningEfforts: efforts })
  }
  return [...models.values()]
}
async function installed(command: string): Promise<boolean> {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      try {
        await access(join(directory, command + ext), constants.X_OK)
        return true
      }
      catch {}
    }
  }
  return false
}
/** Cache keys include credentials; only a digest remains in memory, never in UI. */
export function createProviderCatalog(projectRoot: string, options: { home?: string, fetch?: typeof fetch } = {}) {
  const cache = new Map<CatalogAgent, { fingerprint: string, at: number, data: AgentCatalog }>()
  const pending = new Map<CatalogAgent, Promise<AgentCatalog>>()
  async function detect(): Promise<AgentCatalog[]> {
    const results: AgentCatalog[] = []
    for (const provider of supportedAgents) results.push({ provider, installed: await installed(commands[provider]), models: [] })
    return results
  }
  async function probe(value: string, refresh = false): Promise<AgentCatalog> {
    if (!(supportedAgents as readonly string[]).includes(value))
      throw new DriverError('unsupported', 'Unsupported agent')
    const provider = value as CatalogAgent
    if (pending.has(provider))
      return pending.get(provider)!
    const request = (async (): Promise<AgentCatalog> => {
      const exists = await installed(commands[provider])
      if (!exists)
        return { provider, installed: false, models: [] }
      try {
        await realpath(projectRoot)
        const g = await gateway(provider, options.home ?? homedir())
        const fingerprint = createHash('sha256').update(JSON.stringify([g.url, g.key, g.defaultId])).digest('hex')
        const old = cache.get(provider)
        if (!refresh && old?.fingerprint === fingerprint && Date.now() - old.at < 60000)
          return old.data
        const response = await (options.fetch ?? fetch)(g.url, { headers: { Authorization: `Bearer ${g.key}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
        if (!response.ok)
          throw new Error('Gateway rejected model request')
        const models = parseGatewayModels(await response.json(), g)
        if (provider === 'codex') {
          const d = await config(join(codexCliHome(options.home ?? homedir()), 'config.toml'), true)
          if (typeof d.model_catalog_json === 'string') {
            const catalog = await config(d.model_catalog_json)
            for (const m of models) m.reasoningEfforts = (catalog.models?.find((v: any) => v.slug === m.id)?.supported_reasoning_levels ?? []).map((v: any) => v.effort).filter((v: unknown) => typeof v === 'string')
          }
        }
        const data = { provider, installed: true, models, source: g.url }
        cache.set(provider, { fingerprint, at: Date.now(), data })
        return data
      }
      catch {
        cache.delete(provider)
        return { provider, installed: true, models: [], error: 'Unable to read the configured gateway models. Check the active CLI endpoint and credentials, then retry.' }
      }
    })()
    pending.set(provider, request)
    try {
      return await request
    }
    finally { pending.delete(provider) }
  }
  return { detect, probe }
}
