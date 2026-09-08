import { describe, expect, it } from 'vitest'
import { modelsUrl, parseGatewayModels } from '../src/node/provider-catalog'

describe('gateway catalog', () => {
  it('normalizes protocol base URLs without duplicate v1', () => {
    expect(modelsUrl('https://example.com')).toBe('https://example.com/v1/models')
    expect(modelsUrl('https://example.com/v1/')).toBe('https://example.com/v1/models')
    expect(modelsUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/models')
  })
  it('returns only gateway models with CLI identifiers and safe metadata', () => {
    expect(parseGatewayModels({ data: [{ id: 'a', api_key: 'secret' }, { id: 'b' }, { id: 'a' }] }, { defaultId: 'b', nativeId: id => `funi/${id}` })).toEqual([
      { id: 'funi/a', name: 'a', isDefault: false, reasoningEfforts: [] },
      { id: 'funi/b', name: 'b', isDefault: true, reasoningEfforts: [] },
    ])
  })
  it('does not fall back to built-in models on invalid or empty responses', () => {
    expect(() => parseGatewayModels({ error: 'unauthorized' }, { nativeId: id => id })).toThrow()
    expect(parseGatewayModels({ data: [] }, { nativeId: id => id })).toEqual([])
  })
  it('rejects credentials and queries in base URLs', () => {
    expect(() => modelsUrl('https://user:key@example.com')).toThrow()
    expect(() => modelsUrl('https://example.com?api_key=secret')).toThrow()
  })
})
