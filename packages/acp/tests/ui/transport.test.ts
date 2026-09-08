import type { AcpHost } from '../../src/ui/transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeAgent, createAcpTransport } from '../../src/ui/transport'
import { defaultSelection } from '../../src/ui/types'

function createHost(): AcpHost {
  return {
    chat: { list: vi.fn(), send: vi.fn(), stop: vi.fn(), permission: vi.fn(), answer: vi.fn(), options: vi.fn() },
    catalog: { detect: vi.fn(), probe: vi.fn() },
    composer: { commands: vi.fn(), files: vi.fn() },
    components: { pick: vi.fn(), cancelPick: vi.fn(), capture: vi.fn(), list: vi.fn(), validate: vi.fn(), highlight: vi.fn() },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('aCP host transport', () => {
  it('owns authorization and passes the current token to every protected operation', async () => {
    const host = createHost()
    const authorize = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const transport = createAcpTransport(host, authorize)
    const input = { ...defaultSelection(), requestId: 'r1', sessionId: null, content: 'hello' }
    const permission = { requestId: 'p1', outcome: 'selected' as const, optionId: 'allow' }
    const answer = { requestId: 'q1', outcome: 'answered' as const, answers: [{ questionId: 'question', optionIds: ['yes'] }] }
    const context = { provider: 'kimi' as const, sessionId: null }

    await transport.connect()
    await transport.chat.list()
    await transport.chat.send(input)
    await transport.chat.stop('s1')
    await transport.chat.permission('s1', permission)
    await transport.chat.answer('s1', answer)
    await transport.chat.options('s1', input.options)
    await transport.composer.commands(context, true)
    await transport.composer.files('src')
    expect(host.chat.list).toHaveBeenCalledWith('first')
    expect(host.chat.send).toHaveBeenCalledWith('first', input)
    expect(host.chat.stop).toHaveBeenCalledWith('first', 's1')
    expect(host.chat.permission).toHaveBeenCalledWith('first', 's1', permission)
    expect(host.chat.answer).toHaveBeenCalledWith('first', 's1', answer)
    expect(host.chat.options).toHaveBeenCalledWith('first', 's1', input.options)
    expect(host.composer.commands).toHaveBeenCalledWith('first', context, true)
    expect(host.composer.files).toHaveBeenCalledWith('first', 'src')
    expect(transport.catalog).toBe(host.catalog)

    await transport.connect()
    await transport.chat.list()
    await transport.composer.files('test')
    expect(host.chat.list).toHaveBeenLastCalledWith('second')
    expect(host.composer.files).toHaveBeenLastCalledWith('second', 'test')
  })

  it('keeps component highlight identities and sequences inside each ACP transport', async () => {
    const host = createHost()
    const first = createAcpTransport(host)
    const second = createAcpTransport(host)
    const component = { scopeId: 'scope', appId: 'app', id: '1', instanceToken: 'instance', name: 'App', parentPath: '' }
    await first.composer.components!.pick!()
    await first.composer.components!.cancelPick!()
    expect(host.components!.pick).toHaveBeenCalledOnce()
    expect(host.components!.cancelPick).toHaveBeenCalledOnce()
    await first.composer.components!.list('App')
    await first.composer.components!.capture!([component])
    await first.composer.components!.validate([component])
    await first.composer.components!.highlight(component)
    await first.composer.components!.highlight(null)
    await second.composer.components!.highlight(component)
    expect(host.components!.list).toHaveBeenCalledWith('App')
    expect(host.components!.capture).toHaveBeenCalledWith([component])
    expect(host.components!.validate).toHaveBeenCalledWith([component])
    const calls = vi.mocked(host.components!.highlight).mock.calls
    expect(calls[0]).toEqual([component, expect.any(String), 1])
    expect(calls[1]).toEqual([null, calls[0][1], 2])
    expect(calls[2]).toEqual([component, expect.any(String), 1])
    expect(calls[2][1]).not.toBe(calls[0][1])
    expect(createAcpTransport({ ...host, components: undefined }).composer.components).toBeUndefined()
  })

  it('authorizes through the project-base same-origin endpoint', async () => {
    history.replaceState(null, '', '/project/__devtools__/index.html')
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'capability' }) })
    vi.stubGlobal('fetch', fetch)
    await expect(authorizeAgent()).resolves.toBe('capability')
    expect(fetch).toHaveBeenCalledWith('/project/__vue_devtools_agent_auth', expect.objectContaining({
      method: 'POST',
      headers: { 'X-Vue-Devtools-Agent': '1' },
      signal: expect.any(AbortSignal),
    }))
  })

  it('rejects failed authentication and invalid capability responses', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false })
    vi.stubGlobal('fetch', fetch)
    await expect(authorizeAgent()).rejects.toThrow('local Vite server')
    for (const result of [null, {}, { token: '' }, { token: 123 }]) {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => result })
      await expect(authorizeAgent()).rejects.toThrow('Agent authorization unavailable')
    }
  })
})
