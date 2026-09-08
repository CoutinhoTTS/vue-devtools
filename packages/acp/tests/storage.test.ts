import type { CreateSessionInput } from '../src/node'
import type { StorageEvent } from '../src/schema'
import { appendFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionStore } from '../src/node'

const input: CreateSessionInput = {
  provider: 'codex',
  providerCursor: null,
  options: { mode: 'ask', model: null, reasoningEffort: null },
}
const event: StorageEvent = {
  type: 'message',
  message: { id: 'm1', turnId: 't1', role: 'user', content: [{ type: 'text', text: 'Hello 世界\nnext line' }], createdAt: 1 },
}
let project: string
let other: string
const sessionsPath = () => join(project, '.vue-devtools/agent/sessions')
const sessionPath = (id: string, name: string) => join(sessionsPath(), id, name)

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'devtools-store-'))
  other = await mkdtemp(join(tmpdir(), 'devtools-store-'))
})
afterEach(async () => {
  await rm(project, { recursive: true, force: true })
  await rm(other, { recursive: true, force: true })
})

describe('project session store', () => {
  it('reads lazily and isolates projects across reopening', async () => {
    const store = createSessionStore({ projectRoot: project })
    expect(await store.list()).toEqual([])
    await expect(lstat(join(project, '.vue-devtools'))).rejects.toMatchObject({ code: 'ENOENT' })
    const session = await store.create(input)
    const saved = await store.appendEvent(session.id, event)
    const reopened = createSessionStore({ projectRoot: project })
    expect(await reopened.get(session.id)).toEqual(session)
    expect((await reopened.list()).map(s => s.id)).toEqual([session.id])
    expect(await reopened.readEvents(session.id)).toEqual({ events: [saved], incompleteTail: false })
    expect(await createSessionStore({ projectRoot: other }).list()).toEqual([])
  })

  it('serializes concurrent appends and continues disk sequences after reopen', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const records = await Promise.all(Array.from({ length: 12 }, () => store.appendEvent(id, event)))
    expect(records.map(r => r.sequence)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect((await createSessionStore({ projectRoot: project }).appendEvent(id, event)).sequence).toBe(13)
  })

  it('ignores incomplete tails without changing reads, repairs only under write lock', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    await store.appendEvent(id, event)
    const path = sessionPath(id, 'events.jsonl')
    await appendFile(path, '{"version":1,"partial":')
    const before = await readFile(path)
    const result = await store.readEvents(id)
    expect(result.incompleteTail).toBe(true)
    expect(result.events).toHaveLength(1)
    expect(await readFile(path)).toEqual(before)
    expect((await store.appendEvent(id, event)).sequence).toBe(2)
    expect((await store.readEvents(id)).incompleteTail).toBe(false)
  })

  it('rejects corrupted committed lines without truncating them', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const path = sessionPath(id, 'events.jsonl')
    await writeFile(path, '{broken}\n')
    await expect(store.readEvents(id)).rejects.toThrow('line 1')
    await expect(store.appendEvent(id, event)).rejects.toThrow('line 1')
    expect(await readFile(path, 'utf8')).toBe('{broken}\n')
  })

  it('updates metadata atomically and locks provider after history', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    await store.updateMetadata(id, { provider: 'claude', providerCursor: null })
    await store.appendEvent(id, event)
    await expect(store.updateMetadata(id, { provider: 'codex', providerCursor: null })).rejects.toThrow('Cannot switch')
    await store.updateMetadata(id, { title: 'Renamed', providerCursor: { provider: 'claude', sessionId: 'native-1' } })
    expect((await store.get(id)).title).toBe('Renamed')
    expect(await readdir(join(sessionsPath(), id))).toEqual(['events.jsonl', 'session.json'])
  })

  it('rejects mismatched native cursors and preserves metadata on invalid updates', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const before = await readFile(sessionPath(id, 'session.json'))
    await expect(store.updateMetadata(id, { providerCursor: { provider: 'claude', sessionId: 'wrong' } })).rejects.toThrow('Invalid')
    expect(await readFile(sessionPath(id, 'session.json'))).toEqual(before)
    await store.updateMetadata(id, { title: 'Still writable' })
  })

  it('rejects path traversal and symlinked storage', async () => {
    const store = createSessionStore({ projectRoot: project })
    await expect(store.get('../escape')).rejects.toThrow('Invalid session ID')
    await symlink(other, join(project, '.vue-devtools'))
    await expect(store.create(input)).rejects.toThrow('Unsafe')
    expect(await readdir(other)).toEqual([])
  })

  it('cannot unlock a provider by clearing its established native cursor', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    await store.updateMetadata(id, { providerCursor: { provider: 'codex', threadId: 'native-1' } })
    await expect(store.updateMetadata(id, { providerCursor: null })).rejects.toThrow('Cannot clear')
    await expect(store.updateMetadata(id, { provider: 'claude', providerCursor: { provider: 'claude', sessionId: 'native-2' } })).rejects.toThrow('Cannot switch')
  })

  it('rejects symlinked session files', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const path = sessionPath(id, 'events.jsonl')
    await rm(path)
    const outside = join(other, 'events.jsonl')
    await writeFile(outside, '')
    await symlink(outside, path)
    await expect(store.appendEvent(id, event)).rejects.toThrow('Unsafe')
    expect(await readFile(outside, 'utf8')).toBe('')
  })

  it('refuses writes while another process or stale lock owns the project', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const lock = join(sessionsPath(), '.write-lock')
    await mkdir(lock)
    await expect(store.appendEvent(id, event)).rejects.toThrow('locked')
    await expect(createSessionStore({ projectRoot: project }).updateMetadata(id, { title: 'blocked' })).rejects.toThrow('locked')
    expect((await store.list()).length).toBe(1)
    await rm(lock, { recursive: true })
    expect((await store.appendEvent(id, event)).sequence).toBe(1)
  })

  it('validates versions, record ownership and sequences', async () => {
    const store = createSessionStore({ projectRoot: project })
    const { id } = await store.create(input)
    const saved = await store.appendEvent(id, event)
    const path = sessionPath(id, 'events.jsonl')
    for (const patch of [{ version: 2 }, { sessionId: 'another' }, { sequence: 4 }]) {
      await writeFile(path, `${JSON.stringify({ ...saved, ...patch })}\n`)
      await expect(store.readEvents(id)).rejects.toThrow('Corrupt')
    }
  })
})
