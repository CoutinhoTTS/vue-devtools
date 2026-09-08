import type { VueWrapper } from '@vue/test-utils'
import type { AcpTransport } from '../../src/ui/transport'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AcpChat from '../../src/ui/AcpChat.vue'
import AcpPanel from '../../src/ui/AcpPanel.vue'

function createTransport(): AcpTransport {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    chat: { list: vi.fn().mockResolvedValue([]), send: vi.fn(), stop: vi.fn(), permission: vi.fn(), answer: vi.fn(), options: vi.fn() },
    catalog: { detect: vi.fn().mockResolvedValue([]), probe: vi.fn().mockImplementation(async provider => ({ provider, installed: true, models: [] })) },
    composer: { commands: vi.fn(), files: vi.fn() },
  }
}

let wrapper: VueWrapper | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('aCP panel lifecycle', () => {
  it('owns discovery, connection, selection, and polling cleanup', async () => {
    const transport = createTransport()
    wrapper = shallowMount(AcpPanel, { props: { transport, isDark: true } })
    const chat = wrapper.findComponent(AcpChat)
    expect(chat.props('connected')).toBe(false)
    await flushPromises()
    expect(transport.catalog.probe).toHaveBeenCalledWith('kimi', false)
    expect(transport.connect).toHaveBeenCalledOnce()
    expect(chat.props('connected')).toBe(true)
    expect(chat.props('isDark')).toBe(true)
    expect(chat.props('composerTransport')).toStrictEqual(transport.composer)
    chat.vm.$emit('selectSession', 'session')
    await flushPromises()
    expect(chat.props('selectedId')).toBe('session')
    await vi.advanceTimersByTimeAsync(1200)
    expect(transport.chat.list).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    wrapper = undefined
    await vi.advanceTimersByTimeAsync(2400)
    expect(transport.chat.list).toHaveBeenCalledTimes(2)
  })

  it('surfaces authentication errors and reconnects on agent refresh', async () => {
    const transport = createTransport()
    vi.mocked(transport.connect).mockRejectedValueOnce(new Error('Authorization failed'))
    wrapper = shallowMount(AcpPanel, { props: { transport } })
    const chat = wrapper.findComponent(AcpChat)
    await flushPromises()
    expect(chat.props('chatError')).toBe('Authorization failed')
    expect(transport.chat.list).not.toHaveBeenCalled()
    chat.vm.$emit('refreshAgent', 'codex')
    await flushPromises()
    expect(transport.connect).toHaveBeenCalledTimes(2)
    expect(transport.catalog.probe).toHaveBeenLastCalledWith('codex', true)
    expect(chat.props('connected')).toBe(true)
    expect(chat.props('chatError')).toBe('')
  })

  it('does not start polling when authorization finishes after leaving the panel', async () => {
    const transport = createTransport()
    let authorize!: () => void
    vi.mocked(transport.connect).mockImplementation(() => new Promise<void>(resolve => authorize = resolve))
    wrapper = shallowMount(AcpPanel, { props: { transport } })
    await flushPromises()
    wrapper.unmount()
    wrapper = undefined
    authorize()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2400)
    expect(transport.chat.list).not.toHaveBeenCalled()
  })
})
