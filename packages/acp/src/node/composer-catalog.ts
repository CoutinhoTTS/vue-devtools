import type { ChatProviderId, ComposerCatalog } from '../schema'
import { realpath } from 'node:fs/promises'
import { claudeCommandMetadata } from './claude-command-metadata'
import { codexSkills, nativeCommands, publicCatalog } from './composer-commands'
import { codexCliEnvironment, codexCliHome } from './drivers/codex-home'
import { discoverOpenCodeCommands } from './drivers/open-code'
import { AgentProcess, JsonPeer } from './drivers/process'

/** Sessionless probes use the same restricted environment as their live driver. */
export async function discoverComposerCommands(provider: ChatProviderId, cwd: string, binaryPath?: string): Promise<ComposerCatalog> {
  cwd = await realpath(cwd)
  if (provider === 'kimi' || provider === 'grok')
    return { status: 'pendingSession', commands: [] }
  if (provider === 'openCode')
    return discoverOpenCodeCommands({ provider, providerCursor: null, cwd, binaryPath, options: { mode: 'ask', model: null, reasoningEffort: null }, requestTimeoutMs: 10000 })
  const args = provider === 'codex'
    ? ['app-server', '--listen', 'stdio://']
    : provider === 'pi'
      ? ['--mode', 'rpc', '--offline', '--no-session', '--no-extensions', '--no-context-files', '--tools', 'read,grep,find,ls']
      : ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--permission-mode', 'default', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--settings', JSON.stringify({ disableAllHooks: true })]
  const child = new AgentProcess(binaryPath ?? provider, args, cwd, provider === 'codex' ? codexCliEnvironment() : process.env)
  const peer = new JsonPeer(child, provider, 10000)
  try {
    if (provider === 'codex') {
      await peer.request({ method: 'initialize', params: { clientInfo: { name: 'vue_devtools', version: '8.2.1' }, capabilities: { experimentalApi: true } } })
      await child.write({ method: 'initialized', params: {} })
      return publicCatalog(codexSkills(await peer.request({ method: 'skills/list', params: { cwds: [cwd], forceReload: true } }), cwd))
    }
    const result = await peer.request(provider === 'pi' ? { type: 'get_commands' } : { subtype: 'initialize', hooks: {} })
    const commands = nativeCommands(provider, result.commands)
    return publicCatalog(provider === 'claude' ? await claudeCommandMetadata(commands, cwd) : commands, Array.isArray(result.commands) ? 'ready' : 'unsupported')
  }
  finally { await child.stop() }
}

export function createComposerCatalog(cwd: string, discover = discoverComposerCommands) {
  const cache = new Map<string, Promise<ComposerCatalog>>()
  const active = new Set<string>()
  return {
    invalidate() { cache.clear() },
    async get(provider: ChatProviderId, refresh = false) {
      const key = JSON.stringify([provider, cwd, process.env.PATH, provider === 'codex' ? codexCliHome() : process.env.CLAUDE_CONFIG_DIR, process.env.HOME])
      if (refresh && !active.has(key))
        cache.delete(key)
      let pending = cache.get(key)
      if (!pending) {
        active.add(key)
        pending = discover(provider, cwd).catch((): ComposerCatalog => ({ status: 'error', commands: [], error: 'Unable to load agent commands. Check the agent installation and retry.' })).finally(() => active.delete(key))
        cache.set(key, pending)
      }
      return pending
    },
  }
}
