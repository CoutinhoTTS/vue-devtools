import type { VNode } from 'vue'
import type { AppRecord, VueAppInstance } from '../../types'
import { captureComponentSnapshot } from './snapshot'
import { getInstanceName, getUniqueComponentId, isBeingDestroyed } from './utils'

export interface ComponentReferenceTarget {
  scopeId: string
  appId: string
  id: string
  instanceToken: string
}

export function createComponentReferenceRegistry(options: {
  getApp: () => AppRecord
  highlight: (id: string) => void
  clear: () => void
}) {
  const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  let nextToken = 0
  const tokens = new WeakMap<object, string>()
  let activeApp: AppRecord | undefined
  let generation = 0
  let owner: string | undefined
  let lease: ReturnType<typeof setTimeout> | undefined
  const sequences = new Map<string, number>()
  function scope() {
    const app = options.getApp()
    if (app !== activeApp) {
      activeApp = app
      generation++
      if (owner) {
        clearTimeout(lease)
        options.clear()
        owner = undefined
      }
    }
    return { app, scopeId: `${pageId}:${generation}`, appId: app?.id ?? '' }
  }
  function token(instance: object) {
    let value = tokens.get(instance)
    if (!value) {
      value = `${pageId}:${++nextToken}`
      tokens.set(instance, value)
    }
    return value
  }
  function valid(target: ComponentReferenceTarget) {
    const current = scope()
    const instance = current.app?.instanceMap?.get(target.id)
    if (!instance || current.scopeId !== target.scopeId || current.appId !== target.appId || tokens.get(instance) !== target.instanceToken)
      return false
    for (let parent = instance; parent; parent = parent.parent) {
      if (parent.isUnmounted || parent.isDeactivated)
        return false
    }
    return true
  }
  return {
    resolve(instance: VueAppInstance) {
      const current = scope()
      if (!current.app?.app || instance.appContext?.app !== current.app.app)
        throw new Error('The selected component belongs to another Vue app')
      const parents: string[] = []
      for (let parent = instance; parent; parent = parent.parent) {
        if (isBeingDestroyed(parent) || parent.isDeactivated || parent.type?.devtools?.hide)
          throw new Error('Component is no longer available. Select it again.')
        if (parent !== instance)
          parents.unshift(getInstanceName(parent))
      }
      const id = instance.__VUE_DEVTOOLS_NEXT_UID__ ?? getUniqueComponentId(instance)
      instance.__VUE_DEVTOOLS_NEXT_UID__ = id
      current.app.instanceMap.set(id, instance)
      return { scopeId: current.scopeId, appId: current.appId, id, instanceToken: token(instance), name: getInstanceName(instance), parentPath: parents.join(' > '), file: instance.type?.__file }
    },
    capture(targets: ComponentReferenceTarget[]) {
      if (!Array.isArray(targets) || targets.length > 3)
        throw new Error('Select at most 3 components per message')
      return targets.map((target) => {
        if (!valid(target))
          throw new Error('Component is no longer available. Select it again.')
        const instance = scope().app.instanceMap.get(target.id)!
        const address = instance.subTree?.el?.ownerDocument?.location?.href ?? location.href
        return captureComponentSnapshot(instance, target.id, address)
      })
    },
    validate(targets: ComponentReferenceTarget[]) {
      return targets.slice(0, 100).map(valid)
    },
    async list(query: string) {
      if (typeof query !== 'string' || query.length > 200)
        throw new Error('Invalid component search')
      const current = scope()
      if (!current.app?.app || !current.app.instanceMap)
        throw new Error('No active Vue app')
      const components: (ComponentReferenceTarget & { name: string, parentPath: string, file?: string })[] = []
      const needle = query.trim().toLowerCase()
      const stack: { instance?: VueAppInstance, vnode?: VNode, children?: VNode[], index?: number, parents: string[] }[] = [{ instance: current.app.rootInstance, parents: [] }]
      const seen = new Set<object>()
      let visited = 0
      // Walk live VNodes on demand; never materialize or serialize the inspector tree.
      while (stack.length && components.length < 20 && visited < 20000) {
        if (++visited % 250 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (scope().scopeId !== current.scopeId)
            throw new Error('The active Vue app changed')
        }
        const { instance, vnode, children, index = 0, parents } = stack.pop()!
        if (children) {
          if (index < children.length) {
            stack.push({ children, index: index + 1, parents })
            stack.push({ vnode: children[index], parents })
          }
          continue
        }
        if (instance) {
          if (seen.has(instance) || isBeingDestroyed(instance) || instance.isDeactivated || instance.type?.devtools?.hide)
            continue
          seen.add(instance)
          const name = getInstanceName(instance)
          stack.push({ vnode: instance.subTree, parents: [...parents, name] })
          let at = 0
          for (const char of name.toLowerCase()) {
            if (char === needle[at])
              at++
          }
          if (at !== needle.length)
            continue
          const id = instance.__VUE_DEVTOOLS_NEXT_UID__ ?? getUniqueComponentId(instance)
          instance.__VUE_DEVTOOLS_NEXT_UID__ = id
          current.app.instanceMap.set(id, instance)
          components.push({ scopeId: current.scopeId, appId: current.appId, id, instanceToken: token(instance), name, parentPath: parents.join(' > '), file: instance.type?.__file })
        }
        else if (vnode && typeof vnode === 'object') {
          if (vnode.component) {
            stack.push({ instance: vnode.component, parents })
          }
          else if (vnode.suspense) {
            stack.push({ vnode: vnode.suspense.activeBranch ?? undefined, parents })
          }
          else if (Array.isArray(vnode.children)) {
            stack.push({ children: vnode.children as VNode[], parents })
          }
        }
      }
      return { scopeId: current.scopeId, appId: current.appId, components, truncated: stack.length > 0 }
    },
    highlight(target: ComponentReferenceTarget | null, clientId: string, sequence: number) {
      if (!clientId || !Number.isSafeInteger(sequence) || sequence <= (sequences.get(clientId) ?? -1))
        return false
      sequences.set(clientId, sequence)
      if (sequences.size > 100)
        sequences.delete(sequences.keys().next().value!)
      if (!target || !valid(target)) {
        if (owner === clientId) {
          clearTimeout(lease)
          options.clear()
          owner = undefined
        }
        return false
      }
      options.clear()
      options.highlight(target.id)
      owner = clientId
      clearTimeout(lease)
      lease = setTimeout(() => {
        options.clear()
        owner = undefined
      }, 2500)
      return true
    },
  }
}
