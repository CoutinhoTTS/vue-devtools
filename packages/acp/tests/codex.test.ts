import type { AgentMessage, DriverEvent } from '../src'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { startAgentDriver } from '../src/node'
import { codexCliHome } from '../src/node/drivers/codex-home'
import { applyAssistantEvent } from '../src/node/message-projection'

describe('isolated Codex CLI', () => {
  it('ignores desktop CODEX_HOME', () => {
    vi.stubEnv('CODEX_HOME', '/desktop/config')
    expect(codexCliHome('/user')).toBe('/user/.vue-devtools/codex')
    vi.unstubAllEnvs()
  })
  it('creates, cancels, resumes, and routes approval without duplicating text', async () => {
    const home = await mkdtemp(join(tmpdir(), 'codex-isolated-test-'))
    vi.stubEnv('VUE_DEVTOOLS_CODEX_HOME', home)
    await writeFile(join(home, 'config.toml'), 'model="test"\nmodel_provider="deepseek"\n[model_providers.deepseek]\nwire_api="responses"\n')
    const binaryPath = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url))
    await chmod(binaryPath, 0o755)
    const events: DriverEvent[] = []
    let driver: Awaited<ReturnType<typeof startAgentDriver>> | undefined
    const config = { provider: 'codex' as const, providerCursor: null, binaryPath, cwd: home, options: { mode: 'ask' as const, model: null, reasoningEffort: null } }
    async function wait(type: DriverEvent['type']) {
      await vi.waitFor(() => expect(events.some(e => e.type === type)).toBe(true))
    }
    try {
      driver = await startAgentDriver(config, e => events.push(e))
      await driver.prompt({ turnId: 'ordered', messageId: 'ordered-user', content: [{ type: 'text', text: 'tool-sequence' }] })
      await wait('turnFinished')
      const messages = new Map<string, AgentMessage>()
      for (const event of events) {
        if (event.type === 'textDelta' || event.type === 'toolCallUpdated')
          applyAssistantEvent(messages, event)
      }
      expect([...messages.values()]).toHaveLength(3)
      expect([...messages.values()][0].parts?.map(part => part.type === 'text' ? part.text : part.tool.title)).toEqual(['Before tool. ', 'Read first', 'Read second'])
      expect([...messages.values()][0].parts?.filter(part => part.type === 'tool').every(part => part.type === 'tool' && part.tool.status === 'completed')).toBe(true)
      events.length = 0
      await driver.prompt({ turnId: 't1', messageId: 'm1', content: [{ type: 'text', text: 'hello' }] })
      await wait('turnFinished')
      expect(events.filter(e => e.type === 'textDelta').map(e => e.text).join('')).toBe('MOCK_OK')
      await driver.close()
      driver = await startAgentDriver({ ...config, providerCursor: { provider: 'codex', threadId: 'native-session' } }, e => events.push(e))
      events.length = 0
      await driver.prompt({ turnId: 't2', messageId: 'm2', content: [{ type: 'text', text: 'hang' }] })
      await driver.cancel()
      expect(events.find(e => e.type === 'turnFinished')).toMatchObject({ reason: 'cancelled' })
      events.length = 0
      await driver.prompt({ turnId: 't3', messageId: 'm3', content: [{ type: 'text', text: 'permission' }] })
      await wait('permissionRequested')
      await driver.respondPermission({ requestId: 'approval', outcome: 'cancelled' })
      await wait('turnFinished')
      expect(events.filter(e => e.type === 'textDelta').map(e => e.text).join('')).toBe('DENIED')
      await expect(startAgentDriver({ ...config, providerCursor: { provider: 'codex', threadId: 'missing' } }, () => {})).rejects.toMatchObject({ code: 'resumeFailed' })
    }
    finally {
      await driver?.close()
      vi.unstubAllEnvs()
      await rm(home, { recursive: true, force: true })
    }
  })
})
