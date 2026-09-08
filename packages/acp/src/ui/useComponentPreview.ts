import type { ComposerComponent, ComposerComponentTransport } from '../schema'
import { onBeforeUnmount } from 'vue'

export function useComponentPreview(transport: () => ComposerComponentTransport | undefined) {
  let active = false
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function preview(component: ComposerComponent | null) {
    if (disposed || (!component && !active))
      return
    const version = ++generation
    clearTimeout(timer)
    active = !!component
    try {
      const result = await transport()?.highlight(component)
      if (version === generation && !result)
        active = false
      if (version === generation && result && component)
        timer = setTimeout(() => { void preview(component) }, 1000)
      return !!result
    }
    catch {
      if (version === generation) {
        active = false
        await transport()?.highlight(null).catch(() => {})
      }
      return false
    }
  }
  onBeforeUnmount(() => {
    void preview(null)
    disposed = true
    generation++
    clearTimeout(timer)
  })
  return preview
}
