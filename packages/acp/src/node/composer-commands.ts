import type { ChatProviderId, ComposerCatalog, ComposerCommand } from '../schema'

/** Only the public projection crosses the browser boundary. */
export interface NativeCommand extends ComposerCommand {
  nativeName: string
  path?: string
}

export const newCommand: ComposerCommand = { id: 'application:new', name: 'new', description: 'New conversation', kind: 'command', source: 'application', scope: 'builtin', execution: 'local' }
const validName = (name: unknown): name is string => typeof name === 'string' && /^[\w.:\-]+$/u.test(name) && name.length <= 200

export function publicCatalog(commands: NativeCommand[], status: ComposerCatalog['status'] = 'ready'): ComposerCatalog {
  return { status, commands: commands.map(({ id, name, description, kind, source, scope, execution }) => ({ id, name, description, kind, source, scope, execution })) }
}

export function nativeCommands(provider: ChatProviderId, entries: unknown): NativeCommand[] {
  if (!Array.isArray(entries))
    return []
  const result = new Map<string, NativeCommand>()
  for (const entry of entries.slice(0, 1000)) {
    if (!entry || typeof entry !== 'object' || entry.enabled === false || entry.userInvocable === false)
      continue
    const raw = entry.name
    const skill = entry.source === 'skill' || entry.kind === 'skill' || entry.type === 'skill'
    const name = provider === 'pi' && skill && typeof raw === 'string' ? raw.replace(/^skill:/, '') : raw
    if (!validName(name) || name === 'new')
      continue
    // These are CLI UI/config controls, not stream-json prompt commands.
    if (provider === 'claude' && ['hooks', 'login', 'logout', 'config', 'permissions', 'mcp', 'resume', 'model', 'theme', 'status', 'help', 'exit', 'quit', 'clear'].includes(name))
      continue
    if (provider === 'pi' && !['skill', 'prompt'].includes(entry.source))
      continue
    const kind = skill ? 'skill' : 'command'
    const id = `${provider}:${kind}:${name}`
    const description = entry.shortDescription ?? entry.interface?.shortDescription ?? entry.description
    result.set(name, {
      id,
      name,
      kind,
      source: provider,
      execution: 'native',
      description: typeof description === 'string' ? description.slice(0, 500) : '',
      scope: skill ? 'skill' : entry.sourceInfo?.scope === 'project' ? 'project' : entry.sourceInfo?.scope === 'user' ? 'user' : 'builtin',
      nativeName: provider === 'pi' && skill ? `skill:${name}` : name,
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
    })
  }
  return [...result.values()]
}

export function codexSkills(value: any, cwd: string): NativeCommand[] {
  const group = Array.isArray(value?.data) ? value.data.find((v: any) => v.cwd === cwd) : undefined
  if (!group || !Array.isArray(group.skills))
    throw new Error('Skill catalog unavailable')
  return nativeCommands('codex', group.skills.map((s: any) => ({ ...s, kind: 'skill' }))).filter(s => s.path?.startsWith('/'))
}

export function commandInvocation(content: string): { name: string, arguments: string } | undefined {
  const text = content.trimStart()
  if (!text.startsWith('/'))
    return
  const end = text.search(/\s/)
  const name = text.slice(1, end < 0 ? undefined : end)
  if (!name || name.includes('/'))
    return
  return { name, arguments: end < 0 ? '' : text.slice(end).trimStart() }
}
