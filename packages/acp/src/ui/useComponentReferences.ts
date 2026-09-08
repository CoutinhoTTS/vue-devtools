import type { ComposerComponentTransport, ComposerReference } from '../schema'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useComponentPreview } from './useComponentPreview'

export function useComponentReferences(references: () => ComposerReference[], transport: () => ComposerComponentTransport | undefined) {
  const invalid = ref(new Set<string>())
  const checking = ref(false)
  const rows = computed(() => references().filter(reference => reference.kind === 'component'))
  const preview = useComponentPreview(transport)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(() => rows.value.map(row => row.component), async (components) => {
    const version = ++generation
    clearTimeout(timer)
    void preview(null)
    checking.value = !!components.length
    if (!components.length)
      return
    async function validate() {
      const result = await transport()?.validate(components).catch(() => [])
      if (version !== generation)
        return
      invalid.value = new Set(components.filter((_, index) => !result?.[index]).map(component => component.instanceToken))
      checking.value = false
      if (invalid.value.size)
        void preview(null)
      timer = setTimeout(validate, 1500)
    }
    await validate()
  }, { immediate: true })
  onBeforeUnmount(() => {
    generation++
    clearTimeout(timer)
  })
  return { rows, invalid, checking, preview }
}
