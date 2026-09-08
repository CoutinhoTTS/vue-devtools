import type { ComposerComponentReference } from './composer'

export function validateComponentContext(reference: ComposerComponentReference, content?: string) {
  const fail = () => {
    throw new Error('Invalid component context. Select the component again.')
  }
  const c = reference.component
  const s = reference.snapshot
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
  if (!c || !s || !text(c.name, 200) || ![c.id, c.appId, c.scopeId, c.instanceToken].every(value => text(value, 500)) || !text(c.parentPath, 2000))
    return fail()
  if (Object.keys(s).some(key => !['page', 'capturedAt', 'component', 'state', 'truncated', 'skipped'].includes(key)) || Object.keys(s.component ?? {}).some(key => !['name', 'id', 'parentPath', 'file'].includes(key)))
    return fail()
  if (!Number.isSafeInteger(reference.start) || !Number.isSafeInteger(reference.end) || reference.start < 0 || reference.end <= reference.start)
    return fail()
  const label = `<${c.name}>`
  const token = /[\s"\\]/u.test(label) ? `@${JSON.stringify(label)}` : `@${label}`
  if (content !== undefined && (reference.end > content.length || content.slice(reference.start, reference.end) !== token))
    return fail()
  if (new TextEncoder().encode(JSON.stringify(s)).length > 4096 || !text(s.page, 2000) || !Number.isSafeInteger(s.capturedAt) || s.capturedAt < 0 || !s.component || s.component.id !== c.id || s.component.name !== c.name || !text(s.component.parentPath, 500) || (s.component.file !== undefined && !text(s.component.file, 1000)))
    return fail()
  const url = new URL(s.page)
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.username || url.password || (url.hash && (!url.hash.startsWith('#/') || url.hash.includes('?'))))
    return fail()
  if (!Array.isArray(s.state) || s.state.length > 20 || typeof s.truncated !== 'boolean' || !Number.isSafeInteger(s.skipped) || s.skipped < 0)
    return fail()
  for (const field of s.state) {
    if (!field || Object.keys(field).some(key => !['group', 'key', 'value'].includes(key)) || !['props', 'data', 'setup'].includes(field.group) || !text(field.key, 100))
      return fail()
    const value = field.value
    if (/password|passwd|secret|token|authorization|cookie|api.?key|credential/i.test(field.key) && value !== '[REDACTED]')
      return fail()
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || text(value, 200))
      continue
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail()
    const v = value as Record<string, unknown>
    if (v.type === 'Array' && Number.isSafeInteger(v.length) && Number(v.length) >= 0 && Object.keys(v).length === 2)
      continue
    if (v.type === 'Object' && Array.isArray(v.keys) && v.keys.length <= 5 && v.keys.every(key => text(key, 80)) && Object.keys(v).length === 2)
      continue
    if (text(v.type, 20) && v.omitted === true && Object.keys(v).length === 2)
      continue
    return fail()
  }
}
