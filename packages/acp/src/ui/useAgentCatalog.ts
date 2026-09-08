import type { ChatAgent, ChatProvider } from './types'
import { onBeforeUnmount, ref } from 'vue'

interface CatalogResult { provider: ChatAgent, installed: boolean, models: NonNullable<ChatProvider['models']>, error?: string }
export interface CatalogTransport {
  detect: () => Promise<CatalogResult[]>
  probe: (agent: ChatAgent, refresh: boolean) => Promise<CatalogResult>
}

export function useAgentCatalog(transport: CatalogTransport) {
  const providers = ref<ChatProvider[]>([])
  const available = ref(false)
  const error = ref('')
  let disposed = false
  const pending = new Map<ChatAgent, Promise<void>>()
  const timestamps = new Map<ChatAgent, number>()
  onBeforeUnmount(() => disposed = true)
  function update(agent: ChatAgent, patch: Partial<ChatProvider>) {
    if (disposed)
      return
    const old = providers.value.find(p => p.id === agent)
    const value = { id: agent, modelControl: 'loading' as const, effortControl: 'loading' as const, ...old, ...patch }
    providers.value = [...providers.value.filter(p => p.id !== agent), value]
  }
  async function detect() {
    try {
      const results = await transport.detect()
      if (disposed)
        return
      for (const result of results) update(result.provider, { installed: result.installed })
      available.value = true
      error.value = ''
    }
    catch {
      if (disposed)
        return
      available.value = false
      error.value = 'Agent service unavailable. Start the project with the updated DevTools Vite plugin.'
    }
  }
  function load(agent: ChatAgent, refresh = false): Promise<void> {
    if (pending.has(agent))
      return pending.get(agent)!
    if (!refresh && Date.now() - (timestamps.get(agent) ?? 0) < 60000)
      return Promise.resolve()
    const old = providers.value.find(p => p.id === agent)
    update(agent, { refreshing: true, error: undefined, modelControl: old?.models?.length ? 'available' : 'loading' })
    const request = (async () => {
      try {
        const result = await transport.probe(agent, refresh)
        if (disposed)
          return
        if (result.provider !== agent)
          throw new Error('Mismatched agent catalog')
        update(agent, { installed: result.installed, models: result.models, refreshing: false, error: result.error, modelControl: result.models.length ? 'available' : 'unsupported', effortControl: result.models.some(m => m.reasoningEfforts.length) ? 'available' : 'unsupported' })
        if (!result.error)
          timestamps.set(agent, Date.now())
      }
      catch { update(agent, { refreshing: false, models: [], error: 'Unable to load models. Retry.', modelControl: 'unsupported', effortControl: 'unsupported' }) }
      finally { pending.delete(agent) }
    })()
    pending.set(agent, request)
    return request
  }
  return { providers, available, error, detect, load }
}
