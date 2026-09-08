import { afterEach, describe, expect, it } from 'vitest'
import { cancelInspectComponentHighLighter, inspectComponentHighLighter, inspectComponentInstance } from '../../../devtools-kit/src/core/component-highlighter'

afterEach(() => {
  cancelInspectComponentHighLighter()
  document.body.replaceChildren()
})

function target() {
  const element = document.createElement('button')
  const child = document.createElement('span')
  element.append(child)
  document.body.append(element)
  const instance: any = { uid: 7, type: { name: 'Home' }, vnode: {}, appContext: { app: { __VUE_DEVTOOLS_NEXT_APP_RECORD_ID__: 'app' } } }
  Object.assign(element, { __vueParentComponent: instance })
  return { element, child, instance }
}

describe('page component picker', () => {
  it('selects the clicked component from a nested element without requiring a prior hover', async () => {
    const { child, instance } = target()
    const selection = inspectComponentInstance()
    child.click()
    await expect(selection).resolves.toBe(instance)
  })
  it('does not reuse the hovered component when clicking outside a Vue component', async () => {
    const { element } = target()
    const selection = inspectComponentInstance()
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    document.body.click()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(selection).resolves.toBeNull()
  })
  it('settles cancelled and superseded inspections and preserves the inspector response format', async () => {
    const { child } = target()
    const first = inspectComponentInstance()
    const second = inspectComponentHighLighter()
    await expect(first).resolves.toBeNull()
    child.click()
    await expect(second).resolves.toBe(JSON.stringify({ id: 'app:7' }))
    const cancelled = inspectComponentHighLighter()
    cancelInspectComponentHighLighter()
    await expect(cancelled).resolves.toBe(JSON.stringify({ id: '' }))
  })
})
