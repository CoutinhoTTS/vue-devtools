import type { NativeCommand } from './composer-commands'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Annotate native-reported entries only; never invent executable commands from files. */
export async function claudeCommandMetadata(commands: NativeCommand[], cwd: string) {
  const user = process.env.CLAUDE_CONFIG_DIR && isAbsolute(process.env.CLAUDE_CONFIG_DIR) ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude')
  const roots = [{ path: join(cwd, '.claude'), scope: 'project' as const }, { path: user, scope: 'user' as const }]
  const output: NativeCommand[] = []
  for (const command of commands) {
    let next = command
    if (!command.name.includes(':')) {
      for (const root of roots) {
        if ((await stat(join(root.path, 'skills', command.name, 'SKILL.md')).catch(() => null))?.isFile()) {
          next = { ...command, kind: 'skill', scope: root.scope }
          break
        }
        if ((await stat(join(root.path, 'commands', `${command.name}.md`)).catch(() => null))?.isFile()) {
          next = { ...command, scope: root.scope }
          break
        }
      }
    }
    output.push(next)
  }
  return output
}
