import type { ComposerCommand, ComposerComponent, ComposerFile, ComposerReference } from '../schema'
import Fuse from 'fuse.js'

export interface ComposerTrigger { kind: 'command' | 'file', query: string, start: number, end: number }
export type CompletionRow = { kind: 'command', command: ComposerCommand } | { kind: 'file', file: ComposerFile } | { kind: 'component', component: ComposerComponent }
export const completionGroupLabels = {
  application: 'Application',
  agent: 'Agent Commands',
  skills: 'Skills',
  components: 'Components',
  directories: 'Directories',
  files: 'Files',
} as const
export function completionGroup(row: CompletionRow): keyof typeof completionGroupLabels {
  if (row.kind === 'component')
    return 'components'
  if (row.kind === 'file')
    return row.file.isDirectory ? 'directories' : 'files'
  return row.command.source === 'application' ? 'application' : row.command.kind === 'skill' ? 'skills' : 'agent'
}
export const newCommand: ComposerCommand = { id: 'application:new', name: 'new', description: 'New conversation', kind: 'command', source: 'application', scope: 'builtin', execution: 'local' }

export function detectTrigger(text: string, cursor: number): ComposerTrigger | undefined {
  const end = Math.max(0, Math.min(cursor, text.length))
  const prefix = text.slice(0, end)
  const command = /^\s*\/([^\s/]*)$/.exec(prefix)
  if (command)
    return { kind: 'command', query: command[1], start: prefix.indexOf('/'), end }
  const file = /(?:^|\s)@("(?:[^"\\]|\\.)*|[^\s"]*)$/.exec(prefix)
  if (!file)
    return
  const token = file[1]
  return { kind: 'file', query: token.startsWith('"') ? token.slice(1).replace(/\\(["\\])/g, '$1') : token, start: end - token.length - 1, end }
}

export function mention(path: string) {
  return /[\s"\\]/u.test(path) ? `@${JSON.stringify(path)}` : `@${path}`
}

export function referenceMention(reference: ComposerReference) {
  return mention(reference.kind === 'component' ? `<${reference.component.name}>` : reference.path)
}

export function insertComponentReference(text: string, cursor: number, component: ComposerComponent, references: ComposerReference[] = []) {
  let offset = Math.max(0, Math.min(cursor, text.length))
  const enclosing = references.find(reference => reference.start < offset && offset < reference.end)
  if (enclosing)
    offset = enclosing.end
  const prefix = text.slice(0, offset)
  const separator = prefix && !/\s$/.test(prefix) ? ' ' : ''
  const token = mention(`<${component.name}>`)
  const start = offset + separator.length
  const end = start + token.length
  return {
    text: `${prefix + separator + token} ${text.slice(offset)}`,
    cursor: end + 1,
    reference: { kind: 'component' as const, component, start, end },
  }
}

export function updateReferences(before: string, after: string, references: ComposerReference[]): ComposerReference[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let oldEnd = before.length
  let newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const delta = newEnd - oldEnd
  return references.flatMap((ref) => {
    const next = ref.end <= start ? ref : ref.start >= oldEnd ? { ...ref, start: ref.start + delta, end: ref.end + delta } : undefined
    if (!next || after.slice(next.start, next.end) !== referenceMention(next) || (next.start > 0 && !/\s/.test(after[next.start - 1])) || (next.end < after.length && !/\s/.test(after[next.end])))
      return []
    return [next]
  })
}

export function completionRows(trigger: ComposerTrigger, commands: ComposerCommand[], files: ComposerFile[], components: ComposerComponent[] = []): CompletionRow[] {
  const rows: CompletionRow[] = trigger.kind === 'command' ? commands.map(command => ({ kind: 'command', command })) : files.map(file => ({ kind: 'file', file }))
  const matches = trigger.query ? new Fuse(rows, { keys: ['command.name', 'file.path'], ignoreLocation: true, threshold: 0.5 }).search(trigger.query, { limit: 64 }).map(result => result.item) : rows
  if (trigger.kind === 'file')
    matches.unshift(...components.slice(0, 20).map(component => ({ kind: 'component' as const, component })))
  const order = trigger.query ? [...new Set(matches.map(completionGroup))] : Object.keys(completionGroupLabels)
  return matches.sort((a, b) => order.indexOf(completionGroup(a)) - order.indexOf(completionGroup(b))).slice(0, 64)
}

export function replaceTrigger(text: string, trigger: ComposerTrigger, row: CompletionRow) {
  const insert = row.kind === 'command' ? `/${row.command.name}` : mention(row.kind === 'component' ? `<${row.component.name}>` : row.file.path)
  // Complete the whole current token when the cursor sits inside it.
  let end = trigger.end
  if (trigger.kind === 'file' && text[trigger.start + 1] === '"') {
    end = trigger.start + 2
    while (end < text.length) {
      if (text[end] === '\\') {
        end += 2
        continue
      }
      if (text[end++] === '"')
        break
    }
  }
  else {
    while (end < text.length && !/\s/.test(text[end])) end++
  }
  const next = `${text.slice(0, trigger.start) + insert} ${text.slice(text[end] === ' ' ? end + 1 : end)}`
  const range = { start: trigger.start, end: trigger.start + insert.length }
  const reference: ComposerReference | undefined = row.kind === 'component' ? { kind: 'component', component: row.component, ...range } : row.kind === 'file' ? { path: row.file.path, ...range } : undefined
  return { text: next, cursor: trigger.start + insert.length + 1, reference }
}
