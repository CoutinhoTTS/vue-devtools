import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useAgentCatalog } from '../../src/ui/useAgentCatalog'

describe('agent catalog cache', () => {
  it('deduplicates and isolates out-of-order responses', async () => {
    const resolvers = new Map<string, (v: any) => void>()
    const probe = vi.fn(agent => new Promise<any>(resolve => resolvers.set(agent, resolve)))
    let catalog!: ReturnType<typeof useAgentCatalog>
    const wrapper = mount(defineComponent({ setup() {
      catalog = useAgentCatalog({ detect: async () => [], probe })
      return () => h('div')
    } }))
    try {
      const a = catalog.load('kimi')
      const a2 = catalog.load('kimi')
      const b = catalog.load('pi')
      expect(probe).toHaveBeenCalledTimes(2)
      const result = (provider: string) => ({ provider, installed: true, models: [{ id: `${provider}/a`, name: provider, isDefault: true, reasoningEfforts: [] }] })
      resolvers.get('pi')!(result('pi'))
      await b
      resolvers.get('kimi')!(result('kimi'))
      await a
      await a2
      expect(catalog.providers.value.find(p => p.id === 'pi')?.models?.[0].id).toBe('pi/a')
      expect(catalog.providers.value.find(p => p.id === 'kimi')?.models?.[0].id).toBe('kimi/a')
      await catalog.load('kimi')
      expect(probe).toHaveBeenCalledTimes(2)
      const refresh = catalog.load('kimi', true)
      expect(catalog.providers.value.find(p => p.id === 'kimi')?.models).toHaveLength(1)
      resolvers.get('kimi')!(result('kimi'))
      await refresh
    }
    finally { wrapper.unmount() }
  })
})
