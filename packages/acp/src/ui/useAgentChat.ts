import type { AgentChatSend, AgentChatTransport, PermissionResponse, UserInputResponse } from '../schema'
import type { ChatMessage, ChatSelection, ChatSend, ChatSession } from './types'
import { onBeforeUnmount, ref, shallowRef, triggerRef } from 'vue'

export function useAgentChat(transport: AgentChatTransport) {
  const sessions = shallowRef<ChatSession[]>([])
  const selectedId = ref<string | null>(null)
  const connected = ref(false)
  const submitting = ref(false)
  const error = ref('')
  const accepted = ref<{
    key: string
    content: string
    sequence: number
  }>()
  let disposed = false
  let polling: ReturnType<typeof setTimeout> | undefined
  let loading: Promise<void> | undefined
  let selectionVersion = 0
  let acceptanceSequence = 0
  let retry: AgentChatSend | undefined
  const optimistic = new Map<string, { sessionId: string, message: ChatMessage, session: ChatSession, request: AgentChatSend }>()
  const requests = new Set<string>()
  const optionsPending = new Set<string>()
  function acknowledge(request: AgentChatSend) {
    accepted.value = { key: request.sessionId ?? '__new__', content: request.content, sequence: ++acceptanceSequence }
  }
  async function refresh() {
    if (disposed)
      return
    if (loading)
      return loading
    loading = (async () => {
      try {
        const next = await transport.list()
        if (disposed)
          return
        const merged: ChatSession[] = next.map((s) => {
          const old = sessions.value.find(v => v.id === s.id)
          return { ...s, requestPending: requests.has(s.id), optionsPending: optionsPending.has(s.id), requestError: old?.requestError, optionsError: old?.optionsError }
        })
        for (const [id, item] of optimistic) {
          let target = merged.find(s => s.id === item.sessionId)
          if (target?.messages.some(m => m.id === id)) {
            acknowledge(item.request)
            optimistic.delete(id)
            continue
          }
          if (!target) {
            target = { ...item.session, id: item.sessionId, messages: [...item.session.messages] }
            merged.push(target)
          }
          if (target.status === 'failed' || (target.status === 'idle' && !target.id.startsWith('pending:'))) {
            item.message.delivery = 'failed'
            if (selectedId.value === item.sessionId)
              selectedId.value = item.request.sessionId
          }
          if (!target.messages.some(m => m.id === id))
            target.messages.push({ ...item.message })
        }
        sessions.value = merged
        connected.value = true
      }
      catch {
        if (!disposed) {
          connected.value = false
          error.value = 'Agent connection lost. Reconnect to continue.'
        }
        throw new Error('Agent connection unavailable')
      }
      finally {
        loading = undefined
      }
    })()
    return loading
  }
  function schedule() {
    clearTimeout(polling)
    if (disposed)
      return
    polling = setTimeout(async () => {
      try {
        await refresh()
      }
      catch { }
      schedule()
    }, sessions.value.some(s => ['connecting', 'working', 'waiting', 'background'].includes(s.status)) ? 150 : 1200)
  }
  async function start() {
    error.value = ''
    try {
      await refresh()
    }
    finally {
      schedule()
    }
  }
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(polling)
  })
  function select(id: string | null) {
    selectionVersion++
    selectedId.value = id
  }
  async function send(value: ChatSend) {
    if (submitting.value || !connected.value)
      return
    submitting.value = true
    error.value = ''
    const version = selectionVersion
    const input = JSON.parse(JSON.stringify(value)) as ChatSend
    const local = [...optimistic.values()].find(item => item.sessionId === value.sessionId && item.request.sessionId === null)
    if (local && value.sessionId?.startsWith('pending:'))
      input.sessionId = null
    const same = retry && JSON.stringify({ ...retry, requestId: undefined }) === JSON.stringify(input)
    const request = same ? retry! : { ...input, requestId: crypto.randomUUID() }
    retry = request
    const localId = value.sessionId ?? `pending:${request.requestId}`
    let session = sessions.value.find(s => s.id === localId)
    if (!session) {
      session = { id: localId, title: input.content.trim().slice(0, 70), provider: input.provider, options: input.options, status: 'connecting', messages: [], tools: [] }
      sessions.value = [...sessions.value, session]
    }
    const message: ChatMessage = { id: request.requestId, turnId: request.requestId, role: 'user', createdAt: Date.now(), content: [{ type: 'text', text: input.content }], references: input.references, command: input.command, delivery: 'sending' }
    optimistic.set(request.requestId, { sessionId: localId, message, session, request })
    session.messages = [...session.messages.filter(m => m.id !== message.id), message]
    session.status = 'connecting'
    selectedId.value = localId
    triggerRef(sessions)
    try {
      const result = await transport.send(request)
      if (disposed)
        return
      retry = undefined
      const item = optimistic.get(request.requestId)
      if (item)
        item.sessionId = result.sessionId
      // Remap before polling so new drafts cannot be overwritten by late replies.
      session.id = result.sessionId
      if (version === selectionVersion)
        selectedId.value = result.sessionId
      // A poll started before send acknowledgement may not contain the new session.
      if (loading)
        await loading
      await refresh()
      if (version === selectionVersion)
        selectedId.value = optimistic.get(request.requestId)?.message.delivery === 'failed' ? value.sessionId : result.sessionId
      schedule()
    }
    catch (e) {
      if (!disposed) {
        if (version === selectionVersion)
          selectedId.value = value.sessionId
        error.value = e instanceof Error ? e.message : 'Unable to send message'
        const item = optimistic.get(request.requestId)
        if (item) {
          item.message.delivery = 'failed'
          item.session.status = 'failed'
          const target = sessions.value.find(s => s.id === item.sessionId)
          const m = target?.messages.find(m => m.id === request.requestId)
          if (m)
            m.delivery = 'failed'
          if (target)
            target.status = 'failed'
          triggerRef(sessions)
        }
      }
    }
    finally {
      if (!disposed)
        submitting.value = false
    }
  }
  async function action(id: string, work: () => Promise<void>, kind: 'request' | 'options' = 'request') {
    const set = kind === 'request' ? requests : optionsPending
    if (set.has(id))
      return
    set.add(id)
    const s = sessions.value.find(s => s.id === id)
    if (s) {
      s[kind === 'request' ? 'requestPending' : 'optionsPending'] = true
      s[kind === 'request' ? 'requestError' : 'optionsError'] = undefined
    }
    triggerRef(sessions)
    try {
      await work()
      if (loading)
        await loading
      await refresh()
    }
    catch (e) {
      const current = sessions.value.find(s => s.id === id)
      if (current)
        current[kind === 'request' ? 'requestError' : 'optionsError'] = e instanceof Error ? e.message : 'Operation failed'
      error.value = e instanceof Error ? e.message : 'Operation failed'
    }
    finally {
      set.delete(id)
      const current = sessions.value.find(s => s.id === id)
      if (current)
        current[kind === 'request' ? 'requestPending' : 'optionsPending'] = false
      triggerRef(sessions)
    }
  }
  return {
    sessions,
    selectedId,
    connected,
    submitting,
    error,
    accepted,
    start,
    select,
    send,
    stop: (id: string) => action(id, () => transport.stop(id)),
    permission: (v: {
      sessionId: string
      response: PermissionResponse
    }) => action(v.sessionId, () => transport.permission(v.sessionId, v.response)),
    answer: (v: {
      sessionId: string
      response: UserInputResponse
    }) => action(v.sessionId, () => transport.answer(v.sessionId, v.response)),
    changeOptions: (v: ChatSelection & {
      sessionId: string
    }) => action(v.sessionId, () => transport.options(v.sessionId, v.options), 'options'),
  }
}
