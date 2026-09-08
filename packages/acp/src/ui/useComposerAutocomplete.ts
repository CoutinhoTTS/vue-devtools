import type { Ref } from 'vue'
import type { ComposerCatalog, ComposerComponent, ComposerContext, ComposerFile, ComposerSelection, ComposerTransport } from '../schema'
import type { ComposerEditorHandle } from './composer-editor'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { completionRows, detectTrigger, newCommand, replaceTrigger } from './composer-completion'
import { useComponentPreview } from './useComponentPreview'

export function useComposerAutocomplete(input: Ref<ComposerEditorHandle | undefined>, props: { draft: string, context?: ComposerContext, transport?: ComposerTransport, commands?: ComposerCatalog, connected: boolean }, replace: (result: ReturnType<typeof replaceTrigger>, command?: ComposerSelection) => number | void) {
  const cursor = ref(0)
  const focused = ref(false)
  const composing = ref(false)
  const selected = ref(0)
  const dismissed = ref('')
  const catalog = shallowRef<ComposerCatalog>({ status: 'pendingSession', commands: [] })
  const files = shallowRef<ComposerFile[]>([])
  const components = shallowRef<ComposerComponent[]>([])
  const componentError = ref('')
  const truncated = ref(false)
  const preview = useComponentPreview(() => props.transport?.components)
  let candidateValidation: ReturnType<typeof setTimeout> | undefined
  const loading = ref(false)
  const error = ref('')
  const commandLoading = ref(false)
  let generation = 0
  let commandsGeneration = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const trigger = computed(() => focused.value && !composing.value ? detectTrigger(props.draft, cursor.value) : undefined)
  const key = computed(() => JSON.stringify([props.context, trigger.value]))
  const commands = computed(() => [newCommand, ...catalog.value.commands.filter(c => c.id !== newCommand.id && c.name !== 'new')])
  const rows = computed(() => trigger.value ? completionRows(trigger.value, commands.value, files.value, components.value) : [])
  const visible = computed(() => !!trigger.value && dismissed.value !== key.value)
  watch(rows, value => selected.value = Math.min(selected.value, Math.max(0, value.length - 1)))
  watch(() => visible.value ? rows.value[selected.value] : undefined, (row) => {
    void preview(row?.kind === 'component' ? row.component : null)
  })
  watch(() => visible.value ? components.value : [], (candidates) => {
    clearTimeout(candidateValidation)
    if (!candidates.length)
      return
    async function validate() {
      const result = await props.transport?.components?.validate(candidates).catch(() => [])
      if (!visible.value || components.value !== candidates)
        return
      if (candidates.some((_, index) => !result?.[index])) {
        components.value = candidates.filter((_, index) => result?.[index])
        componentError.value = 'Page components changed. Search again.'
      }
      else {
        candidateValidation = setTimeout(validate, 1500)
      }
    }
    candidateValidation = setTimeout(validate, 1500)
  })
  const status = computed(() => {
    if (trigger.value?.kind === 'command' ? commandLoading.value : loading.value)
      return 'Loading...'
    if (error.value)
      return error.value
    if (trigger.value?.kind === 'file' && componentError.value)
      return componentError.value
    if (trigger.value?.kind === 'file' && truncated.value)
      return 'Component results limited. Refine your search.'
    if (trigger.value?.kind === 'command') {
      const value = catalog.value
      if (value.status === 'pendingSession')
        return 'Agent commands available after the first message'
      if (value.status === 'unsupported')
        return 'Agent commands are not supported by this connection'
      if (value.status === 'error')
        return value.error ?? 'Unable to load commands'
    }
    return rows.value.length ? '' : 'No matches'
  })
  async function loadCommands(refresh = false) {
    const version = ++commandsGeneration
    if (!props.transport || !props.context || !props.connected)
      return
    commandLoading.value = true
    error.value = ''
    try {
      const value = await props.transport.commands(props.context, refresh)
      if (version === commandsGeneration)
        catalog.value = value
    }
    catch {
      if (version === commandsGeneration)
        error.value = 'Unable to load commands'
    }
    finally {
      if (version === commandsGeneration)
        commandLoading.value = false
    }
  }
  watch(() => JSON.stringify([props.context?.provider, props.context?.sessionId, props.connected]), () => {
    generation++
    commandsGeneration++
    catalog.value = { status: 'pendingSession', commands: [] }
    files.value = []
    components.value = []
    loading.value = false
    commandLoading.value = false
    dismissed.value = ''
    error.value = ''
    void loadCommands()
  }, { immediate: true })
  watch(() => props.commands, (value) => {
    if (value)
      catalog.value = value
  }, { immediate: true })
  watch(key, () => {
    selected.value = 0
    const version = ++generation
    clearTimeout(timer)
    if (trigger.value?.kind !== 'file') {
      loading.value = false
      return
    }
    files.value = []
    components.value = []
    componentError.value = ''
    truncated.value = false
    error.value = ''
    if (!props.transport || (!props.connected && !props.transport.components)) {
      loading.value = false
      error.value = 'File search is not connected'
      return
    }
    const query = trigger.value.query
    loading.value = true
    timer = setTimeout(async () => {
      try {
        if (props.transport?.components) {
          try {
            const result = await props.transport.components.list(query)
            if (version === generation) {
              components.value = result.components.slice(0, 20)
              truncated.value = result.truncated
            }
          }
          catch {
            if (version === generation)
              componentError.value = 'Unable to load page components'
          }
        }
        if (version !== generation || !props.connected)
          return
        const result = await props.transport!.files(query)
        if (version === generation)
          files.value = result.files
      }
      catch {
        if (version === generation)
          error.value = 'Unable to search files'
      }
      finally {
        if (version === generation)
          loading.value = false
      }
    }, 100)
  })
  function syncCursor() {
    cursor.value = input.value?.getCursor() ?? props.draft.length
  }
  async function accept(index = selected.value) {
    const active = trigger.value
    const row = rows.value[index]
    if (!active || !row)
      return
    if (row.kind === 'component') {
      const version = generation
      const valid = await props.transport?.components?.validate([row.component]).catch(() => [])
      if (version !== generation || !visible.value)
        return
      if (!valid?.[0]) {
        components.value = components.value.filter(component => component !== row.component)
        componentError.value = 'Component is no longer available. Search again.'
        return
      }
    }
    void preview(null)
    const result = replaceTrigger(props.draft, active, row)
    const nextCursor = replace(result, row.kind === 'command' ? { id: row.command.id, name: row.command.name, kind: row.command.kind } : undefined) ?? result.cursor
    await nextTick()
    input.value?.focus()
    input.value?.setCursor(nextCursor)
    syncCursor()
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || composing.value || event.keyCode === 229)
      return false
    if (!visible.value)
      return false
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      dismissed.value = key.value
      return true
    }
    if (rows.value.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + rows.value.length) % rows.value.length
      return true
    }
    if (rows.value.length && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ['Tab', 'Enter'].includes(event.key)) {
      event.preventDefault()
      void accept()
      return true
    }
    return false
  }
  onBeforeUnmount(() => {
    clearTimeout(candidateValidation)
    generation++
    commandsGeneration++
    clearTimeout(timer)
  })
  return { cursor, focused, composing, rows, visible, selected, status, loading: computed(() => trigger.value?.kind === 'command' ? commandLoading.value : loading.value), syncCursor, accept, keydown, retry: () => {
    if (trigger.value?.kind === 'command') {
      void loadCommands(true)
    }
    else {
      dismissed.value = ''
      focused.value = false
      void nextTick(() => focused.value = true)
    }
  } }
}
