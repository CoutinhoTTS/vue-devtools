import type { DriverControl, DriverEvent, DriverStartOptions } from '../src'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentChatService, openAgentSession, startAgentDriver } from '../src/node'
import { createComposerCatalog, discoverComposerCommands } from '../src/node/composer-catalog'
import { nativeCommands, publicCatalog } from '../src/node/composer-commands'
import { createComposerFileIndex, referenceText, validateReferences } from '../src/node/composer-files'
import { codexCliEnvironment } from '../src/node/drivers/codex-home'

let cwd: string
const binaryPath = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url))
const drivers: DriverControl[] = []
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'composer-test-'))
  await chmod(binaryPath, 0o755)
})
afterEach(async () => {
  await Promise.all(drivers.splice(0).map(d => d.close()))
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true })
})

describe('composer catalogs and native execution', () => {
  for (const provider of ['codex', 'claude', 'openCode', 'pi', 'kimi', 'grok'] as const) {
    it(`${provider} discovers commands without a model turn and executes the native request`, async () => {
      if (provider === 'codex') {
        vi.stubEnv('VUE_DEVTOOLS_CODEX_HOME', cwd)
        await writeFile(join(cwd, 'config.toml'), 'model="test"\nmodel_provider="test"\n[model_providers.test]\nwire_api="responses"\n')
      }
      const before = await discoverComposerCommands(provider, cwd, binaryPath)
      expect(before.status).toBe(['kimi', 'grok'].includes(provider) ? 'pendingSession' : 'ready')
      expect(JSON.stringify(before)).not.toContain('PRIVATE TEMPLATE')
      expect(JSON.stringify(before)).not.toContain('SKILL.md')
      const events: DriverEvent[] = []
      const config: DriverStartOptions = { provider, providerCursor: null, cwd, binaryPath, options: { model: null, reasoningEffort: null, mode: 'ask' }, requestTimeoutMs: 1500 }
      const driver = await startAgentDriver(config, e => events.push(e))
      drivers.push(driver)
      const catalog = await driver.getCommands!()
      expect(catalog.status).toBe('ready')
      expect(events.some(e => e.type === 'turnStarted')).toBe(false)
      const command = catalog.commands.find(c => c.name === (provider === 'codex' || provider === 'pi' ? 'test-skill' : 'review'))!
      expect(command).toBeDefined()
      const display = `/${command.name} target`
      await driver.prompt({ turnId: 'turn', messageId: 'message', content: [{ type: 'text', text: display }], displayContent: [{ type: 'text', text: display }], command: { id: command.id, name: command.name, arguments: 'target' } })
      await vi.waitFor(() => expect(events.some(e => e.type === 'turnFinished')).toBe(true))
      expect(events.find(e => e.type === 'promptSubmitted')).toMatchObject({ message: { content: [{ type: 'text', text: display }] } })
      const output = events.filter(e => e.type === 'textDelta').map(e => e.text).join('')
      if (provider === 'codex')
        expect(JSON.parse(output)).toContainEqual({ type: 'skill', name: 'test-skill', path: join(await realpath(cwd), 'SKILL.md') })
      else if (provider === 'pi')
        expect(output).toBe('/skill:test-skill target')
      else if (provider === 'openCode')
        expect(output).toBe('review:target')
      else
        expect(output).toBe('/review target')
      await expect(driver.prompt({ turnId: 'bad', messageId: 'bad', content: [{ type: 'text', text: '/unknown' }], command: { id: 'unknown', name: 'unknown', arguments: '' } })).rejects.toThrow('no longer available')
    })
  }
  it('deduplicates discovery and explicitly invalidates cached results', async () => {
    const discover = vi.fn(async () => ({ status: 'ready' as const, commands: [] }))
    const catalog = createComposerCatalog(cwd, discover)
    await Promise.all([catalog.get('pi'), catalog.get('pi')])
    expect(discover).toHaveBeenCalledTimes(1)
    catalog.invalidate()
    await catalog.get('pi')
    expect(discover).toHaveBeenCalledTimes(2)
  })
  it('filters disabled and unsupported controls and never exposes private metadata', () => {
    const commands = nativeCommands('claude', [{ name: 'hooks' }, { name: 'review', description: 'Review', path: '/private', template: 'secret' }, { name: 'bad', enabled: false }])
    expect(publicCatalog(commands).commands.map(c => c.name)).toEqual(['review'])
    expect(JSON.stringify(publicCatalog(commands))).not.toMatch(/private|secret/)
    expect(nativeCommands('pi', [{ name: 'ext', source: 'extension' }])).toEqual([])
  })
  it('uses isolated Codex credentials without forwarding desktop routing', () => {
    vi.stubEnv('VUE_DEVTOOLS_CODEX_HOME', cwd)
    vi.stubEnv('CODEX_HOME', '/desktop')
    vi.stubEnv('OPENAI_API_KEY', 'not-forwarded')
    vi.stubEnv('OPENAI_BASE_URL', 'not-forwarded')
    expect(codexCliEnvironment()).toMatchObject({ CODEX_HOME: cwd })
    expect(codexCliEnvironment().OPENAI_API_KEY).toBeUndefined()
    expect(codexCliEnvironment().OPENAI_BASE_URL).toBeUndefined()
  })
})

describe('workspace references', () => {
  it('delivers component snapshots to the agent and preserves them across reloads', async () => {
    let service = createAgentChatService(cwd, config => openAgentSession({ ...config, binaryPath }))
    const snapshot = { page: 'http://localhost:3000/', capturedAt: Date.now(), component: { name: 'Home', id: 'a:1', parentPath: 'Root', file: 'src/Home.vue' }, state: [{ group: 'setup' as const, key: 'visible', value: false }], truncated: false, skipped: 0 }
    const reference = { kind: 'component' as const, component: { name: 'Home', id: 'a:1', appId: 'a', scopeId: 'page', instanceToken: 'one', parentPath: 'Root' }, start: 5, end: 12, snapshot }
    try {
      const request = { requestId: 'component', sessionId: null, provider: 'kimi' as const, options: { mode: 'ask' as const, model: null, reasoningEffort: null }, content: 'echo:@<Home>', references: [reference] }
      await service.send(request)
      await vi.waitFor(async () => {
        const session = (await service.list())[0]
        expect(session.status).toBe('idle')
        const reply = session.messages.filter(m => m.role === 'assistant').flatMap(m => m.content).map(c => c.type === 'text' ? c.text : '').join('')
        expect(reply).toContain('visible')
        expect(reply).toContain('http://localhost:3000/')
      })
      await service.close()
      service = createAgentChatService(cwd, config => openAgentSession({ ...config, binaryPath }))
      expect((await service.list())[0].messages[0].references).toEqual([reference])
      expect((await service.list())[0].messages[0].content).toEqual([{ type: 'text', text: request.content }])
    }
    finally { await service.close() }
  })
  it('indexes files and directories, ignores outputs and refreshes after invalidation', async () => {
    await mkdir(join(cwd, 'src'))
    await mkdir(join(cwd, 'node_modules'))
    await writeFile(join(cwd, 'src', 'a b.ts'), 'secret content')
    await writeFile(join(cwd, 'node_modules', 'hidden.ts'), 'x')
    const index = createComposerFileIndex(cwd)
    const result = await index.search('')
    expect(result.files).toContainEqual({ path: 'src/', isDirectory: true })
    expect(result.files).toContainEqual({ path: 'src/a b.ts', isDirectory: false })
    expect(JSON.stringify(result)).not.toMatch(/hidden|secret content/)
    await writeFile(join(cwd, 'new.ts'), 'x')
    index.invalidate()
    expect((await index.search('nwts')).files).toContainEqual({ path: 'new.ts', isDirectory: false })
  })
  it('rejects stale, mutated, traversing and external symlink references', async () => {
    await writeFile(join(cwd, 'file.txt'), 'do not attach')
    const text = '@file.txt'
    const ref = { path: 'file.txt', start: 0, end: text.length }
    expect(await validateReferences(cwd, text, [ref])).toContain('file.txt')
    expect(await validateReferences(cwd, text, [ref])).not.toContain('do not attach')
    await expect(validateReferences(cwd, '@other.txt', [ref])).rejects.toThrow('no longer matches')
    await expect(validateReferences(cwd, '@../outside', [{ path: '../outside', start: 0, end: 11 }])).rejects.toThrow()
    await symlink(tmpdir(), join(cwd, 'outside'))
    await expect(validateReferences(cwd, '@outside', [{ path: 'outside', start: 0, end: 8 }])).rejects.toThrow('outside')
    await rm(join(cwd, 'file.txt'))
    await expect(validateReferences(cwd, text, [ref])).rejects.toThrow('no longer exists')
    expect(referenceText('src/a b.ts')).toBe('@"src/a b.ts"')
  })
  it('never creates sessions for menu requests or invalid submissions and persists references', async () => {
    const service = createAgentChatService(cwd, config => openAgentSession({ ...config, binaryPath }))
    try {
      expect((await service.commands({ provider: 'kimi', sessionId: null })).status).toBe('pendingSession')
      expect(await service.list()).toEqual([])
      const request = { requestId: 'one', sessionId: null, provider: 'kimi' as const, options: { mode: 'ask' as const, model: null, reasoningEffort: null }, content: '/unknown' }
      await expect(service.send(request)).rejects.toThrow('unavailable')
      expect(await service.list()).toEqual([])
      await writeFile(join(cwd, 'file.ts'), 'not attached')
      const input = { ...request, content: 'Read @file.ts', references: [{ path: 'file.ts', start: 5, end: 13 }] }
      const result = await service.send(input)
      expect(await service.send(input)).toEqual(result)
      await vi.waitFor(async () => expect((await service.list())[0].messages[0]?.references).toEqual(input.references))
      expect((await service.list())[0].messages[0].content).toEqual([{ type: 'text', text: input.content }])
      await expect(service.send({ ...input, content: 'different' })).rejects.toThrow('reused')
    }
    finally { await service.close() }
  })
})
