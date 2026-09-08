import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { completionRows, detectTrigger, mention, newCommand, replaceTrigger, updateReferences } from '../../src/ui/composer-completion'
import { useComposerAutocomplete } from '../../src/ui/useComposerAutocomplete'

describe('composer completion', () => {
  it('ignores late catalogs after agent changes and late searches after query changes', async () => {
    vi.useFakeTimers()
    const catalogs: ((value: any) => void)[] = []
    const searches: ((value: any) => void)[] = []
    const props = reactive({ draft: '/', connected: true, context: { provider: 'kimi' as any, sessionId: null }, transport: { commands: () => new Promise<any>(resolve => catalogs.push(resolve)), files: () => new Promise<any>(resolve => searches.push(resolve)) } })
    let completion!: ReturnType<typeof useComposerAutocomplete>
    const wrapper = mount(defineComponent({ setup() {
      completion = useComposerAutocomplete(ref(), props, () => {})
      return () => h('div')
    } }))
    try {
      completion.focused.value = true
      completion.cursor.value = 1
      props.context.provider = 'pi'
      await nextTick()
      catalogs[1]({ status: 'ready', commands: [{ ...newCommand, id: 'pi:skill:current', name: 'current', source: 'pi' }] })
      await flushPromises()
      catalogs[0]({ status: 'ready', commands: [{ ...newCommand, id: 'kimi:command:stale', name: 'stale', source: 'kimi' }] })
      await flushPromises()
      expect(completion.rows.value.some(row => row.kind === 'command' && row.command.name === 'stale')).toBe(false)
      props.draft = '@old'
      completion.cursor.value = 4
      await nextTick()
      await vi.advanceTimersByTimeAsync(110)
      props.draft = '@new'
      await nextTick()
      await vi.advanceTimersByTimeAsync(110)
      searches[1]({ files: [{ path: 'new.ts', isDirectory: false }], truncated: false })
      await flushPromises()
      searches[0]({ files: [{ path: 'old.ts', isDirectory: false }], truncated: false })
      await flushPromises()
      expect(completion.rows.value).toEqual([{ kind: 'file', file: { path: 'new.ts', isDirectory: false } }])
    }
    finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
  it('only detects leading slash and token-start mentions', () => {
    expect(detectTrigger('/re', 3)).toMatchObject({ kind: 'command', query: 're' })
    expect(detectTrigger('/review target', 14)).toBeUndefined()
    expect(detectTrigger('text /re', 8)).toBeUndefined()
    expect(detectTrigger('a@b.com', 7)).toBeUndefined()
    expect(detectTrigger('read @src/a', 11)).toMatchObject({ kind: 'file', query: 'src/a', start: 5 })
    expect(detectTrigger('@"src/a b', 9)).toMatchObject({ kind: 'file', query: 'src/a b' })
  })
  it('replaces tokens without damaging following text and quotes space paths', () => {
    const text = 'read @src/old next'
    const result = replaceTrigger(text, detectTrigger(text, 8)!, { kind: 'file', file: { path: 'src/a b.ts', isDirectory: false } })
    expect(result.text).toBe('read @"src/a b.ts" next')
    expect(result.reference).toEqual({ path: 'src/a b.ts', start: 5, end: 18 })
    expect(result.text.slice(result.reference!.start, result.reference!.end)).toBe(mention('src/a b.ts'))
  })
  it('updates offsets and drops references whose token is edited or deleted', () => {
    const text = 'read @file.ts'
    const refs = [{ path: 'file.ts', start: 5, end: 13 }]
    expect(updateReferences(text, `please ${text}`, refs)).toEqual([{ path: 'file.ts', start: 12, end: 20 }])
    expect(updateReferences(text, 'read @other.ts', refs)).toEqual([])
    expect(updateReferences(text, 'read ', refs)).toEqual([])
    expect(updateReferences(text, `${text}x`, refs)).toEqual([])
    expect(updateReferences(text, `${text} next`, refs)).toEqual(refs)
  })
  it('fuzzy ranks names and caps results', () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/file-${i}.ts`, isDirectory: false }))
    expect(completionRows({ kind: 'file', query: '', start: 0, end: 1 }, [], files)).toHaveLength(64)
    expect(completionRows({ kind: 'command', query: 'nw', start: 0, end: 3 }, [newCommand], [])).toHaveLength(1)
  })
})
