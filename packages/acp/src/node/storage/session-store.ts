import type { AgentSession, ProviderBinding, SessionOptions, StorageEvent, StoredEvent, StoredSession } from '../../schema'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { appendJsonl, readJsonl } from './jsonl'
import { validateEvent, validateSession, validateStoredSession } from './validation'

export type CreateSessionInput = ProviderBinding & { title?: string, options: SessionOptions }
export type SessionMetadataUpdate = Partial<Pick<AgentSession, 'title' | 'options' | 'status' | 'lastReplyAt'>> & Partial<ProviderBinding>

function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function assertPath(path: string, directory: boolean) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1))
    throw new Error(`Unsafe session storage path: ${path}`)
}

async function atomicJson(path: string, value: StoredSession) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`)
      await file.sync()
    }
    finally {
      await file.close()
    }
    await rename(temporary, path)
  }
  finally {
    await rm(temporary, { force: true })
  }
}

export function createSessionStore({ projectRoot }: { projectRoot: string }) {
  if (!isAbsolute(projectRoot))
    throw new Error('projectRoot must be an absolute server-owned path')
  let queue = Promise.resolve()

  async function root(create = false) {
    let path = await realpath(projectRoot)
    await assertPath(path, true)
    for (const part of ['.vue-devtools', 'agent', 'sessions']) {
      path = join(path, part)
      if (create) {
        try {
          await mkdir(path, { mode: 0o700 })
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
            throw error
        }
      }
      await assertPath(path, true)
    }
    return path
  }

  function validateId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Invalid session ID')
  }

  async function directory(id: string) {
    validateId(id)
    const path = join(await root(), id)
    await assertPath(path, true)
    return path
  }

  async function get(id: string): Promise<AgentSession> {
    const path = join(await directory(id), 'session.json')
    await assertPath(path, false)
    const data: unknown = JSON.parse(await readFile(path, 'utf8'))
    validateStoredSession(data)
    if (data.session.id !== id || data.session.cwd !== await realpath(projectRoot))
      throw new Error('Session does not belong to this project')
    return data.session
  }

  async function log(id: string) {
    const path = join(await directory(id), 'events.jsonl')
    await assertPath(path, false)
    return { path, ...await readJsonl(path, id) }
  }

  function write<T>(create: boolean, action: (path: string) => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      const path = await root(create)
      const lock = join(path, '.write-lock')
      try {
        await mkdir(lock, { mode: 0o700 })
      }
      catch (cause) {
        throw new Error('Session store locked; another writer or interrupted write requires attention', { cause })
      }
      try {
        return await action(path)
      }
      finally {
        await rm(lock, { recursive: true })
      }
    })
    queue = result.then(() => {}, () => {})
    return result
  }

  return {
    async create(input: CreateSessionInput): Promise<AgentSession> {
      const now = Date.now()
      const session = {
        provider: input.provider,
        providerCursor: structuredClone(input.providerCursor),
        options: structuredClone(input.options),
        id: randomUUID(),
        title: input.title ?? 'New session',
        cwd: await realpath(projectRoot),
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        lastReplyAt: null,
      } as AgentSession
      validateSession(session)
      return write(true, async (path) => {
        const dir = join(path, `.create-${session.id}`)
        await mkdir(dir, { mode: 0o700 })
        try {
          const file = await open(join(dir, 'events.jsonl'), 'wx', 0o600)
          await file.close()
          await atomicJson(join(dir, 'session.json'), { version: 1, session })
          await rename(dir, join(path, session.id))
        }
        catch (error) {
          await rm(dir, { recursive: true, force: true })
          throw error
        }
        return session
      })
    },
    async list(): Promise<AgentSession[]> {
      let path: string
      try {
        path = await root()
      }
      catch (error) {
        if (missing(error))
          return []
        throw error
      }
      const sessions: AgentSession[] = []
      for (const name of await readdir(path)) {
        if (name === '.write-lock' || name.startsWith('.create-'))
          continue
        sessions.push(await get(name))
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    },
    get,
    async updateMetadata(id: string, patch: SessionMetadataUpdate): Promise<AgentSession> {
      validateId(id)
      const update = structuredClone(patch)
      const allowed = ['title', 'options', 'status', 'lastReplyAt', 'provider', 'providerCursor']
      if (Object.keys(update).some(key => !allowed.includes(key)))
        throw new Error('Immutable or unknown metadata field')
      return write(false, async () => {
        const current = await get(id)
        const next = { ...current, ...update, updatedAt: Date.now() } as AgentSession
        validateSession(next)
        if (current.providerCursor !== null && next.providerCursor === null)
          throw new Error('Cannot clear an established native session cursor')
        if (next.provider !== current.provider && (current.providerCursor !== null || (await log(id)).events.length > 0))
          throw new Error('Cannot switch provider after a native session or history exists')
        await atomicJson(join(await directory(id), 'session.json'), { version: 1, session: next })
        return next
      })
    },
    async appendEvent(id: string, event: StorageEvent): Promise<StoredEvent> {
      validateId(id)
      // Reject unserializable input before any files are touched.
      const serialized = JSON.stringify(event)
      const snapshot: unknown = JSON.parse(serialized)
      validateEvent(snapshot)
      return write(false, async () => {
        await get(id)
        const data = await log(id)
        const stored: StoredEvent = { version: 1, sessionId: id, sequence: data.events.length + 1, timestamp: Date.now(), event: snapshot }
        await appendJsonl(data.path, stored, data.committedBytes)
        return stored
      })
    },
    async readEvents(id: string) {
      await get(id)
      const { events, incompleteTail } = await log(id)
      return { events, incompleteTail }
    },
  }
}
