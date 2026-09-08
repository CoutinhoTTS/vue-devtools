import type { ComposerReference, ComposerSelection } from '../schema'

export function commandPrefix(command?: ComposerSelection) {
  return command ? `/${command.name} ` : ''
}

export function pinnedSubmission(text: string, command?: ComposerSelection, references: ComposerReference[] = []) {
  const prefix = commandPrefix(command)
  return {
    content: prefix + text,
    ...(command ? { command } : {}),
    ...(references.length ? { references: references.map(ref => ({ ...ref, start: ref.start + prefix.length, end: ref.end + prefix.length })) } : {}),
  }
}

/** Old messages have no selection metadata; only recognize a whole leading slash token. */
export function commandDisplay(text: string, selection?: ComposerSelection) {
  const invocation = /^\s*\/([\w.:-]+)(?=\s|$)/u.exec(text)
  if (!invocation || (selection && selection.name !== invocation[1]))
    return { text, command: undefined, prefixLength: 0 }
  const prefixLength = invocation[0].length + (text[invocation[0].length] === ' ' ? 1 : 0)
  return {
    text: text.slice(prefixLength),
    command: selection ?? { id: `legacy:${invocation[1]}`, name: invocation[1] },
    prefixLength,
  }
}
