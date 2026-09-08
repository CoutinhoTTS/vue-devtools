import type { DriverEvent, ProviderKind } from '../src'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionStore, openAgentSession } from '../src/node'
import { deadline } from '../src/node/drivers/process'

async function main() {
  const providers = process.argv.slice(2)
  const selected = providers.length ? providers : ['kimi', 'grok', 'claude', 'pi', 'openCode']
  for (const provider of selected) {
    const projectRoot = await mkdtemp(join(tmpdir(), 'devtools-agent-live-'))
    let runtime: Awaited<ReturnType<typeof openAgentSession>> | undefined
    let settle: ((event: DriverEvent) => void) | undefined
    let text = ''
    const onEvent = (event: DriverEvent) => {
      if (event.type === 'textDelta')
        text += event.text
      if (event.type === 'permissionRequested')
        void runtime?.respondPermission({ requestId: event.request.id, outcome: 'cancelled' })
      if (event.type === 'userInputRequested')
        void runtime?.respondUserInput({ requestId: event.request.id, outcome: 'cancelled' })
      if (event.type === 'error')
        console.log(`${provider} error: ${event.error.message}`)
      settle?.(event)
    }
    try {
      const store = createSessionStore({ projectRoot })
      const session = await store.create({ provider: provider as ProviderKind, providerCursor: null, options: { model: null, reasoningEffort: null, mode: 'ask' } })
      const open = () => openAgentSession({ projectRoot, sessionId: session.id, onEvent, requestTimeoutMs: 30000, turnTimeoutMs: 60000 })
      const send = async (prompt: string) => {
        text = ''
        const turnId = randomUUID()
        const finished = deadline(new Promise<void>((resolve, reject) => {
          settle = (event) => {
            if (event.type === 'error')
              reject(new Error(event.error.message))
            if (event.type === 'turnFinished' && event.turnId === turnId)
              event.reason === 'completed' ? resolve() : reject(new Error(event.reason))
          }
        }), 65000)
        void finished.catch(() => { })
        await runtime!.prompt({ turnId, messageId: randomUUID(), content: [{ type: 'text', text: prompt }] })
        await finished
        await runtime!.flush()
      }
      console.log(`START ${provider}`)
      runtime = await open()
      const marker = `ACP_${randomUUID().replaceAll('-', '')}`
      await send(`Connectivity test. Remember this marker: ${marker}. Reply only with that marker. Do not use tools or read files.`)
      if (!text.includes(marker))
        throw new Error('Initial reply did not contain marker')
      await runtime.close()
      const saved = await store.get(session.id)
      if (!saved.providerCursor)
        throw new Error('Native cursor was not persisted')
      const count = (await store.readEvents(session.id)).events.length
      runtime = await open()
      if ((await store.readEvents(session.id)).events.length !== count)
        throw new Error('Restore duplicated display history')
      await send('What exact marker did I ask you to remember? Reply only with the marker. Do not use tools or read files.')
      if (!text.includes(marker))
        throw new Error('Restored reply did not remember marker')
      const turnId = randomUUID()
      const cancelled = deadline(new Promise<void>((resolve, reject) => {
        settle = (event) => {
          if (event.type === 'error')
            reject(new Error(event.error.message))
          if (event.type === 'turnFinished' && event.turnId === turnId)
            event.reason === 'cancelled' ? resolve() : reject(new Error('Cancellation was not acknowledged'))
        }
      }), 35000)
      void cancelled.catch(() => {})
      await runtime.prompt({ turnId, messageId: randomUUID(), content: [{ type: 'text', text: 'Write a long numbered list of 1000 numbers. Do not use any tools.' }] })
      await runtime.cancel()
      await cancelled
      await send('Reply only CONNECTION_AFTER_CANCEL_OK. Do not use tools.')
      if (!text.includes('CONNECTION_AFTER_CANCEL_OK'))
        throw new Error('Could not continue after cancellation')
      console.log(JSON.stringify({ provider, passed: true, restored: true, cancelled: true, continuedAfterCancel: true }))
    }
    catch (error) {
      process.exitCode = 1
      console.log(JSON.stringify({ provider, passed: false, error: error instanceof Error ? error.message : String(error) }))
    }
    finally {
      settle = undefined
      await runtime?.close().catch(() => { })
      await rm(projectRoot, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
