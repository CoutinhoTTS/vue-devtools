import type { ComposerComponentTransport, ComposerReference } from '../schema'

export async function captureReferences(references: ComposerReference[], transport?: ComposerComponentTransport) {
  const components = references.filter(reference => reference.kind === 'component')
  if (!components.length)
    return references
  if (!transport?.capture)
    throw new Error('Component context is unavailable. Reconnect DevTools.')
  if (components.length > 3)
    throw new Error('Select at most 3 components per message')
  let timer: ReturnType<typeof setTimeout> | undefined
  const snapshots = await Promise.race([
    transport.capture(components.map(reference => reference.component)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Component capture timed out. Reconnect DevTools and try again.')), 5000)
    }),
  ]).finally(() => clearTimeout(timer))
  if (snapshots.length !== components.length)
    throw new Error('Unable to capture all selected components. Select them again.')
  let index = 0
  return references.map(reference => reference.kind === 'component' ? { ...reference, snapshot: snapshots[index++] } : reference)
}
