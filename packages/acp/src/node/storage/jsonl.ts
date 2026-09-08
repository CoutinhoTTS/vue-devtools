import type { StoredEvent } from '../../schema'
import { Buffer } from 'node:buffer'
import { open, readFile } from 'node:fs/promises'
import { validateStoredEvent } from './validation'

/** A newline is the commit boundary. Uncommitted tail bytes are never returned. */
export async function readJsonl(path: string, sessionId: string) {
  const data = await readFile(path)
  const committedBytes = data.lastIndexOf(10) + 1
  const lines = data.subarray(0, committedBytes).toString('utf8').split('\n').slice(0, -1)
  const events: StoredEvent[] = []
  for (const [index, line] of lines.entries()) {
    try {
      const event: unknown = JSON.parse(line)
      validateStoredEvent(event)
      if (event.sessionId !== sessionId || event.sequence !== index + 1)
        throw new Error('Session ID or sequence mismatch')
      events.push(event)
    }
    catch (cause) {
      throw new Error(`Corrupt session log at line ${index + 1}`, { cause })
    }
  }
  return { events, committedBytes, incompleteTail: committedBytes !== data.length }
}

/** Call only while holding the project's writer lock. */
export async function appendJsonl(path: string, event: StoredEvent, committedBytes: number) {
  const file = await open(path, 'r+')
  try {
    await file.truncate(committedBytes)
    const bytes = Buffer.from(`${JSON.stringify(event)}\n`)
    let written = 0
    while (written < bytes.length) {
      const result = await file.write(bytes, written, bytes.length - written, committedBytes + written)
      if (!result.bytesWritten)
        throw new Error('Session log write made no progress')
      written += result.bytesWritten
    }
    await file.sync()
  }
  finally {
    await file.close()
  }
}
