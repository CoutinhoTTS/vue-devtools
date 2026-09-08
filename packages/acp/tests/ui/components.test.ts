import type { ComposerComponent, ComposerComponentTransport } from '@vue/devtools-acp'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { createComponentReferenceRegistry } from '../../../devtools-kit/src/core/component/references'
import { completionRows, detectTrigger, insertComponentReference, replaceTrigger, updateReferences } from '../../src/ui/composer-completion'
import { useComponentReferences } from '../../src/ui/useComponentReferences'
import { useComposerAutocomplete } from '../../src/ui/useComposerAutocomplete'

const component: ComposerComponent = { scopeId: 'page:1', appId: 'app', id: 'app:1', instanceToken: 'instance', name: 'Home', parentPath: 'Root' }
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
})

function runtime(count = 40) {
  const app: any = { id: 'app', app: {}, instanceMap: new Map() }
  const make = (name: string, uid: number): any => ({ uid, type: { name, __file: `${name}.vue` }, appContext: { app: { __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: 'app' } }, subTree: { children: [] }, parent: null })
  const root = make('Root', 0)
  root.root = root
  app.rootInstance = root
  const children = Array.from({ length: count }, (_, i) => ({ component: Object.assign(make(`Child${i}`, i + 1), { parent: root }) }))
  root.subTree.children = children
  let current = app
  const highlight = vi.fn()
  const clear = vi.fn()
  const registry = createComponentReferenceRegistry({ getApp: () => current, highlight, clear })
  return { app, root, children, registry, highlight, clear, switchApp: (value: any) => current = value }
}

describe('component references', () => {
  it('resolves a picked instance without searching or truncating candidates', () => {
    const { registry, app, children } = runtime(1000)
    const instance = children[999].component
    instance.appContext.app = app.app
    const reference = registry.resolve(instance)
    expect(reference).toMatchObject({ name: 'Child999', parentPath: 'Root' })
    expect(app.instanceMap.size).toBe(1)
    expect(registry.validate([reference])).toEqual([true])
    expect(registry.resolve(instance).instanceToken).toBe(reference.instanceToken)
    instance.isDeactivated = true
    expect(() => registry.resolve(instance)).toThrow('no longer available')
    expect(() => registry.resolve(children[0].component)).toThrow('another Vue app')
  })
  it('inserts a picked component at the cursor without replacing text or existing pins', () => {
    const result = insertComponentReference('Check this', 6, component)
    expect(result.text).toBe('Check @<Home> this')
    expect(result.reference).toMatchObject({ kind: 'component', start: 6, end: 13, component })
    const next = insertComponentReference(result.text, 10, { ...component, name: 'Other' }, [result.reference])
    expect(next.text).toBe('Check @<Home> @<Other>  this')
    expect(updateReferences(result.text, next.text, [result.reference])).toEqual([result.reference])
    expect(insertComponentReference('hello', 5, component).text).toBe('hello @<Home> ')
  })
  it('collects at most 20 candidates on demand without capturing the complete tree', async () => {
    const { registry, app } = runtime(1000)
    expect(app.instanceMap.size).toBe(0)
    const first = await registry.list('')
    expect(first.components).toHaveLength(20)
    expect(first.truncated).toBe(true)
    expect(app.instanceMap.size).toBe(20)
    const filtered = await registry.list('chld999')
    expect(filtered.components.map(item => item.name)).toEqual(['Child999'])
    expect(filtered.components[0].parentPath).toBe('Root')
  })
  it('rejects stale instance identities and out-of-order highlights', async () => {
    const state = runtime(2)
    const [target] = (await state.registry.list('Child0')).components
    expect(state.registry.highlight(target, 'client', 2)).toBe(true)
    expect(state.registry.highlight(null, 'client', 3)).toBe(false)
    expect(state.registry.highlight(target, 'client', 1)).toBe(false)
    expect(state.highlight).toHaveBeenCalledTimes(1)
    state.app.instanceMap.set(target.id, { ...state.children[0].component })
    expect(state.registry.validate([target])).toEqual([false])
    expect(state.registry.highlight(target, 'client', 4)).toBe(false)
  })
  it('excludes inactive components and invalidates references on App changes', async () => {
    const state = runtime(2)
    state.children[1].component.isDeactivated = true
    const result = await state.registry.list('Child')
    expect(result.components).toHaveLength(1)
    state.switchApp({ ...state.app, id: 'another' })
    expect(state.registry.validate(result.components)).toEqual([false])
  })
  it('retains instance identity through text edits and limits the component group', () => {
    const result = replaceTrigger('@Ho', detectTrigger('@Ho', 3)!, { kind: 'component', component })
    expect(result.text).toBe('@<Home> ')
    expect(result.reference).toMatchObject({ kind: 'component', component })
    expect(updateReferences(result.text, `Check ${result.text}`, [result.reference!])[0]).toMatchObject({ start: 6, component })
    expect(updateReferences(result.text, '@<Other> ', [result.reference!])).toEqual([])
    expect(completionRows({ kind: 'file', query: '', start: 0, end: 1 }, [], [], Array.from({ length: 40 }, () => component))).toHaveLength(20)
  })
  it('does not search on mount, debounces mentions, previews selection and cleans up on Escape', async () => {
    vi.useFakeTimers()
    const other = { ...component, id: 'app:2', instanceToken: 'other' }
    const transport: ComposerComponentTransport = { list: vi.fn(async () => ({ scopeId: 'page:1', appId: 'app', components: [component, other], truncated: false })), highlight: vi.fn(async () => true), validate: vi.fn(async () => [true]) }
    const props = reactive({ draft: '', connected: true, transport: { commands: vi.fn(), files: vi.fn(async () => ({ files: [], truncated: false })), components: transport } })
    let completion!: ReturnType<typeof useComposerAutocomplete>
    mounted.push(mount(defineComponent({ setup() {
      completion = useComposerAutocomplete(ref(), props, () => {})
      return () => h('div')
    } })))
    await vi.advanceTimersByTimeAsync(500)
    expect(transport.list).not.toHaveBeenCalled()
    completion.focused.value = true
    props.draft = '@H'
    completion.cursor.value = 2
    await nextTick()
    props.draft = '@Ho'
    completion.cursor.value = 3
    await nextTick()
    await vi.advanceTimersByTimeAsync(110)
    expect(transport.list).toHaveBeenCalledExactlyOnceWith('Ho')
    expect(transport.highlight).toHaveBeenLastCalledWith(component)
    completion.keydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await nextTick()
    expect(transport.highlight).toHaveBeenLastCalledWith(other)
    completion.keydown(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(transport.highlight).toHaveBeenLastCalledWith(null)
  })
  it('ignores stale searches after the query changes', async () => {
    vi.useFakeTimers()
    const pending: ((value: any) => void)[] = []
    const transport = { list: vi.fn(() => new Promise<any>(resolve => pending.push(resolve))), highlight: vi.fn(async () => true), validate: vi.fn(async () => [true]) }
    const props = reactive({ draft: '@Old', connected: true, transport: { commands: vi.fn(), files: vi.fn(async () => ({ files: [], truncated: false })), components: transport } })
    let completion!: ReturnType<typeof useComposerAutocomplete>
    mounted.push(mount(defineComponent({ setup() {
      completion = useComposerAutocomplete(ref(), props, () => {})
      return () => h('div')
    } })))
    completion.focused.value = true
    completion.cursor.value = 4
    await nextTick()
    await vi.advanceTimersByTimeAsync(110)
    props.draft = '@New'
    await nextTick()
    await vi.advanceTimersByTimeAsync(110)
    pending[1]({ components: [{ ...component, name: 'New' }], truncated: false })
    await flushPromises()
    pending[0]({ components: [{ ...component, name: 'Old' }], truncated: false })
    await flushPromises()
    expect(completion.rows.value).toMatchObject([{ kind: 'component', component: { name: 'New' } }])
  })
  it('validates only selected references and stops polling when removed', async () => {
    vi.useFakeTimers()
    const references = ref<any[]>([])
    const transport = { list: vi.fn(), highlight: vi.fn(async () => true), validate: vi.fn(async () => [false]) }
    let state!: ReturnType<typeof useComponentReferences>
    mounted.push(mount(defineComponent({ setup() {
      state = useComponentReferences(() => references.value, () => transport)
      return () => h('div')
    } })))
    await vi.advanceTimersByTimeAsync(2000)
    expect(transport.validate).not.toHaveBeenCalled()
    references.value = [{ kind: 'component', component, start: 0, end: 7 }]
    await flushPromises()
    expect(state.invalid.value.has(component.instanceToken)).toBe(true)
    expect(transport.list).not.toHaveBeenCalled()
    references.value = []
    await nextTick()
    transport.validate.mockClear()
    await vi.advanceTimersByTimeAsync(2000)
    expect(transport.validate).not.toHaveBeenCalled()
  })
})
