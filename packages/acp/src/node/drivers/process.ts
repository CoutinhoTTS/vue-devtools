import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export class DriverError extends Error {
  constructor(public code: 'unsupported' | 'busy' | 'resumeFailed' | 'disconnected' | 'invalidRequest' | 'internal', message: string) {
    super(message)
  }
}
export async function deadline<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DriverError('disconnected', 'Agent request timed out')), ms)
    })])
  }
  finally {
    clearTimeout(timer!)
  }
}
/** Only LF frames messages; Unicode line separators and UTF-8 remain intact. */
export class JsonLines {
  private decoder = new StringDecoder('utf8')
  private buffer = ''
  constructor(private receive: (value: any) => void) { }
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk)
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024)
      throw new DriverError('invalidRequest', 'Agent frame exceeds 8 MiB')
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      if (line.trim())
        this.receive(JSON.parse(line))
      index = this.buffer.indexOf('\n')
    }
  }
}
export class AgentProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly exited: Promise<number | null>
  private stopping?: Promise<void>
  private closed = false
  readonly stdoutListeners = new Set<(chunk: Buffer) => void>()
  readonly exitListeners = new Set<(code: number | null) => void>()
  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
    this.child = spawn(binary, args, { cwd, env, stdio: 'pipe', shell: false, detached: process.platform !== 'win32' })
    this.child.stderr.on('data', () => { }) // Raw provider logs can contain credentials.
    this.child.stdin.on('error', () => { })
    this.child.stdout.on('data', (chunk: Buffer) => {
      for (const listener of this.stdoutListeners)
        listener(chunk)
    })
    this.exited = new Promise((resolve) => {
      const done = (code: number | null) => {
        if (this.closed)
          return
        this.closed = true
        resolve(code)
        for (const listener of this.exitListeners)
          listener(code)
      }
      this.child.once('error', () => done(null))
      this.child.once('close', done)
    })
  }

  async write(value: unknown) {
    if (this.closed)
      throw new DriverError('disconnected', 'Agent process exited')
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${JSON.stringify(value)}\n`, error => error ? reject(error) : resolve())
    })
  }

  stop(): Promise<void> {
    return this.stopping ??= (async () => {
      const kill = (signal: NodeJS.Signals) => {
        if (!this.child.pid)
          return
        try {
          if (process.platform === 'win32')
            this.child.kill(signal)
          else
            process.kill(-this.child.pid, signal)
        }
        catch { }
      }
      kill('SIGTERM')
      try {
        await deadline(this.exited, 2000)
      }
      catch {
        kill('SIGKILL')
        await this.exited
      }
      kill('SIGKILL')
    })()
  }
}
export class JsonPeer {
  private serial = 0
  private pending = new Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
  }>()

  onMessage: (value: any) => void = () => { }
  constructor(readonly process: AgentProcess, readonly flavor: 'pi' | 'claude' | 'codex', private timeout = 30000) {
    const lines = new JsonLines((value) => {
      const response = flavor === 'claude' ? value.type === 'control_response' && value.response : flavor === 'codex' ? !value.method && value.id != null && value : value.type === 'response' && value
      const id = response && (response.request_id ?? response.id)
      const pending = id && this.pending.get(id)
      if (pending) {
        this.pending.delete(id)
        if (response.success === false || response.subtype === 'error' || (flavor === 'codex' && response.error))
          pending.reject(new DriverError('internal', String(response.error?.message ?? response.error ?? 'Agent rejected request')))
        else
          pending.resolve(flavor === 'codex' ? response.result : response.response ?? response.data ?? response)
      }
      else {
        this.onMessage(value)
      }
    })
    process.stdoutListeners.add((chunk) => {
      try {
        lines.push(chunk)
      }
      catch {
        this.rejectAll(new DriverError('invalidRequest', 'Invalid agent JSONL'))
        void process.stop()
      }
    })
    process.exitListeners.add(() => this.rejectAll(new DriverError('disconnected', 'Agent process exited')))
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values())
      pending.reject(error)
    this.pending.clear()
  }

  async request(request: Record<string, unknown>, fatal = true): Promise<any> {
    const id = `devtools-${++this.serial}`
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    const result = deadline(response, this.timeout)
    void result.catch(() => { })
    try {
      await this.process.write(this.flavor === 'claude' ? { type: 'control_request', request_id: id, request } : { ...request, id })
      return await result
    }
    catch (error) {
      if (fatal)
        await this.process.stop()
      throw error
    }
    finally {
      this.pending.delete(id)
    }
  }
}
