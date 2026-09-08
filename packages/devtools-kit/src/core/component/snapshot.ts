import type { VueAppInstance } from '../../types'
import { toRaw } from './state/util'
import { getInstanceName } from './utils'

const sensitive = /password|passwd|secret|token|authorization|cookie|api.?key|credential/i
export function snapshotPage(address: string) {
  const url = new URL(address)
  return `${url.origin}${url.pathname}${url.hash.startsWith('#/') ? url.hash.split('?')[0] : ''}`
}

export function captureComponentSnapshot(instance: VueAppInstance, id: string, address: string) {
  const snapshot = {
    page: snapshotPage(address),
    capturedAt: Date.now(),
    component: { name: getInstanceName(instance).slice(0, 200), id, parentPath: '', file: instance.type?.__file?.slice(0, 1000) as string | undefined },
    state: [] as { group: 'props' | 'data' | 'setup', key: string, value: unknown }[],
    truncated: false,
    skipped: 0,
  }
  const parents: string[] = []
  for (let parent = instance.parent; parent && parents.length < 4; parent = parent.parent)
    parents.unshift(getInstanceName(parent).slice(0, 80))
  snapshot.component.parentPath = parents.join(' > ')
  function summarize(value: unknown): unknown {
    value = toRaw(value)
    if (value && typeof value === 'object') {
      // Read stored ref values without evaluating computed or custom ref getters.
      if (Object.getOwnPropertyDescriptor(value, '__v_isRef')?.value === true) {
        const stored = Object.getOwnPropertyDescriptor(value, '_value')
        return stored && 'value' in stored ? summarize(stored.value) : { type: 'Ref', omitted: true }
      }
      if (Array.isArray(value))
        return { type: 'Array', length: value.length }
      const keys: string[] = []
      for (const key in value) {
        if (Object.hasOwn(value, key) && !sensitive.test(key))
          keys.push(key.slice(0, 80))
        if (keys.length === 5)
          break
      }
      return { type: 'Object', keys }
    }
    if (typeof value === 'string') {
      if (value.length > 200)
        snapshot.truncated = true
      return value.slice(0, 200)
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
      return value
    return { type: typeof value, omitted: true }
  }
  const groups = { props: instance.props, data: instance.data, setup: instance.devtoolsRawSetupState || instance.setupState }
  for (const group of ['props', 'data', 'setup'] as const) {
    try {
      const source = toRaw(groups[group])
      let visited = 0
      for (const key in source) {
        if (++visited > 100 || snapshot.state.length >= 20) {
          snapshot.truncated = true
          break
        }
        if (!Object.hasOwn(source, key) || key.startsWith('__'))
          continue
        try {
          const descriptor = Object.getOwnPropertyDescriptor(source, key)
          if (!descriptor || !('value' in descriptor) || typeof descriptor.value === 'function') {
            snapshot.skipped++
            continue
          }
          const value = sensitive.test(key) ? '[REDACTED]' : summarize(descriptor.value)
          snapshot.state.push({ group, key: key.slice(0, 100), value })
          if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 4000) {
            snapshot.state.pop()
            snapshot.truncated = true
            break
          }
        }
        catch { snapshot.skipped++ }
      }
    }
    catch { snapshot.skipped++ }
  }
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 4096)
    throw new Error('Component metadata exceeds the context limit')
  return snapshot
}
