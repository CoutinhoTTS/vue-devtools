import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { captureComponentSnapshot, snapshotPage } from '../../../devtools-kit/src/core/component/snapshot'
import { captureReferences } from '../../src/ui/capture-references'

describe('component snapshots', () => {
  it('captures current ref values, masks secrets and summarizes objects without invoking getters', () => {
    let reads = 0
    const visible = ref(false)
    const instance: any = { type: { name: 'Home', __file: 'src/Home.vue' }, props: { token: 'secret' }, data: {}, devtoolsRawSetupState: { visible, items: [1, 2], obj: { name: 'private', count: 3 }, fn: () => {} } }
    Object.defineProperty(instance.data, 'danger', { enumerable: true, get() {
      reads++
      throw new Error('no')
    } })
    visible.value = true
    const snapshot = captureComponentSnapshot(instance, 'a:1', 'http://localhost:3000/?token=secret#/home?key=secret')
    expect(snapshot.page).toBe('http://localhost:3000/#/home')
    expect(snapshot.state).toContainEqual({ group: 'setup', key: 'visible', value: true })
    expect(snapshot.state).toContainEqual({ group: 'setup', key: 'items', value: { type: 'Array', length: 2 } })
    expect(snapshot.state).toContainEqual({ group: 'props', key: 'token', value: '[REDACTED]' })
    expect(JSON.stringify(snapshot)).not.toContain('private')
    expect(reads).toBe(0)
    expect(snapshot.skipped).toBe(2)
  })
  it('bounds field count, string lengths and byte size', () => {
    const snapshot = captureComponentSnapshot({ type: { name: 'Home' }, props: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`field${i}`, '中'.repeat(300)])) } as any, 'a', 'http://localhost/')
    expect(snapshot.state.length).toBeLessThanOrEqual(20)
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(4096)
    expect(snapshot.truncated).toBe(true)
    expect(snapshotPage('https://user:password@example.com/a?token=x#secret')).toBe('https://example.com/a')
  })
  it('captures at send time and propagates capture failures', async () => {
    const component = { name: 'Home', id: 'a:1', scopeId: 'page', appId: 'a', instanceToken: 'one', parentPath: '' }
    const references: any[] = [{ kind: 'component', component, start: 0, end: 7 }]
    const snapshot = captureComponentSnapshot({ type: { name: 'Home' }, props: { count: 2 } } as any, 'a:1', 'http://localhost/')
    const transport: any = { capture: async () => [snapshot] }
    expect(await captureReferences(references, transport)).toMatchObject([{ snapshot }])
    transport.capture = async () => {
      throw new Error('Component is no longer available')
    }
    await expect(captureReferences(references, transport)).rejects.toThrow('no longer available')
    await expect(captureReferences([...references, ...references, ...references, ...references], transport)).rejects.toThrow('at most 3')
  })
})
