#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const flavor = args[0] === 'app-server' ? 'codex' : args[0] === 'serve' ? 'openCode' : args.includes('rpc') ? 'pi' : args.includes('stream-json') ? 'claude' : 'acp'
const sessionId = flavor === 'claude' ? args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1] : 'native-session'
let promptRequest
let toolInput
const send = m => process.stdout.write(`${JSON.stringify(m)}\n`)
function complete(text = 'MOCK_OK') {
  if (flavor === 'codex') {
    send({ method: 'item/agentMessage/delta', params: { threadId: sessionId, itemId: 'assistant', delta: text } })
    send({ method: 'item/completed', params: { threadId: sessionId, item: { id: 'assistant', type: 'agentMessage', text } } })
    send({ method: 'turn/completed', params: { threadId: sessionId, turn: { id: 'turn-native', status: 'completed' } } })
  }
  if (flavor === 'acp') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } })
    send({ jsonrpc: '2.0', id: promptRequest, result: { stopReason: 'end_turn' } })
  }
  if (flavor === 'pi') {
    send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
    send({ type: 'agent_end' })
  }
  if (flavor === 'claude') {
    send({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
    send({ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text }] } })
    send({ type: 'result', session_id: sessionId, is_error: false })
  }
}
function handlePrompt(text) {
  if (text === 'tool-sequence') {
    const chunk = (value, id) => {
      if (flavor === 'codex')
        send({ method: 'item/agentMessage/delta', params: { threadId: sessionId, itemId: id, delta: value } })
      if (flavor === 'acp')
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } } })
      if (flavor === 'pi') {
        send({ type: 'message_start', message: { id, role: 'assistant' } })
        send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: value } })
      }
      if (flavor === 'claude') {
        send({ type: 'stream_event', session_id: sessionId, event: { type: 'message_start', message: { id, role: 'assistant' } } })
        send({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: value } } })
      }
    }
    const tool = (id, completed = false) => {
      if (flavor === 'codex')
        send({ method: completed ? 'item/completed' : 'item/started', params: { threadId: sessionId, item: { id, type: 'commandExecution', command: `Read ${id}`, status: completed ? 'completed' : 'inProgress' } } })
      if (flavor === 'acp')
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: completed ? 'tool_call_update' : 'tool_call', toolCallId: id, title: `Read ${id}`, status: completed ? 'completed' : 'in_progress' } } })
      if (flavor === 'pi')
        send({ type: completed ? 'tool_execution_end' : 'tool_execution_start', toolCallId: id, toolName: `Read ${id}`, isError: false })
      if (flavor === 'claude') {
        if (completed)
          send({ type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] } })
        else
          send({ type: 'stream_event', session_id: sessionId, event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name: `Read ${id}` } } })
      }
    }
    chunk('Before tool. ', 'before')
    tool('first')
    tool('second')
    chunk('After tools. ', 'after')
    // Complete in reverse order after a different message has started.
    tool('second', true)
    tool('first', true)
    complete('Final answer.')
    return
  }
  if (text.startsWith('echo:')) {
    complete(text.slice(5))
    return
  }
  if (text.startsWith('/')) {
    complete(text)
    return
  }
  if (text === 'permission' && flavor === 'codex') {
    send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: sessionId, command: 'test-command' } })
    return
  }
  if (text === 'crash')
    process.exit(7)
  if (text === 'hang')
    return
  if (text === 'permission' && flavor === 'acp') {
    send({ jsonrpc: '2.0', id: 'approval', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'tool-1', title: 'Write file' }, options: [{ optionId: 'yes', name: 'Allow once', kind: 'allow_once' }, { optionId: 'no', name: 'Deny', kind: 'reject_once' }] } })
    return
  }
  if ((text === 'permission' || text === 'question') && flavor === 'claude') {
    toolInput = text === 'question' ? { questions: [{ question: 'Which?', options: [{ label: 'A' }], multiSelect: false }] } : { file_path: 'file.txt' }
    send({ type: 'control_request', request_id: 'approval', request: { subtype: 'can_use_tool', tool_name: text === 'question' ? 'AskUserQuestion' : 'Write', input: toolInput } })
    return
  }
  complete()
}
if (flavor === 'openCode') {
  const subscribers = new Set()
  let counter = 0
  const emit = (m) => {
    for (const res of subscribers)
      res.write(`data: ${JSON.stringify(m)}\n\n`)
  }
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`) {
      res.writeHead(401).end()
      return
    }
    let body = ''
    for await (const chunk of req)
      body += chunk
    const data = body ? JSON.parse(body) : {}
    const route = req.url
    if (route === '/command') {
      res.end(JSON.stringify([{ name: 'review', description: 'Review code', source: 'command' }, { name: 'test-skill', description: 'Test skill', source: 'skill', template: 'PRIVATE TEMPLATE' }]))
      return
    }
    if (route === '/event') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': ready\n\n')
      subscribers.add(res)
      req.on('close', () => subscribers.delete(res))
      return
    }
    res.setHeader('Content-Type', 'application/json')
    if (route === '/session') {
      res.end(JSON.stringify({ id: `session-${++counter}` }))
      return
    }
    const id = route.split('/')[2]
    if (route.endsWith('/prompt_async') || route.endsWith('/command')) {
      res.writeHead(204).end()
      setTimeout(() => {
        emit({ type: 'message.updated', properties: { info: { sessionID: id, id: 'user', role: 'user' } } })
        emit({ type: 'message.part.updated', properties: { part: { sessionID: id, messageID: 'user', id: 'user-part', type: 'text', text: 'USER MUST NOT LEAK' } } })
        emit({ type: 'message.updated', properties: { info: { sessionID: id, id: 'assistant', role: 'assistant' } } })
        emit({ type: 'message.part.updated', properties: { part: { sessionID: id, messageID: 'assistant', id: 'thought', type: 'reasoning', text: 'PRIVATE' } } })
        emit({ type: 'message.part.delta', properties: { sessionID: id, messageID: 'assistant', partID: 'thought', field: 'text', delta: 'PRIVATE' } })
        if (data.parts?.[0]?.text === 'hang')
          return
        if (data.parts?.[0]?.text === 'tool-sequence') {
          const text = (messageID, value) => {
            emit({ type: 'message.updated', properties: { info: { sessionID: id, id: messageID, role: 'assistant' } } })
            emit({ type: 'message.part.updated', properties: { part: { sessionID: id, messageID, id: `${messageID}-text`, type: 'text', text: value } } })
          }
          const tool = (callID, status) => emit({ type: 'message.part.updated', properties: { part: { sessionID: id, messageID: 'before', id: callID, type: 'tool', callID, tool: `Read ${callID}`, state: { status } } } })
          text('before', 'Before tool. ')
          tool('first', 'running')
          tool('second', 'running')
          text('after', 'After tools. ')
          tool('second', 'completed')
          tool('first', 'completed')
          text('final', 'Final answer.')
          emit({ type: 'session.idle', properties: { sessionID: id } })
          return
        }
        emit({ type: 'message.part.updated', properties: { part: { sessionID: id, messageID: 'assistant', id: 'text', type: 'text', text: '' } } })
        emit({ type: 'message.part.delta', properties: { sessionID: id, messageID: 'assistant', partID: 'text', field: 'text', delta: data.command ? `${data.command}:${data.arguments}` : 'MOCK_OK' } })
        emit({ type: 'session.idle', properties: { sessionID: id } })
      }, 15)
      return
    }
    if (route.endsWith('/abort'))
      emit({ type: 'session.idle', properties: { sessionID: id } })
    res.end(JSON.stringify({ id, directory: process.cwd() }))
  })
  server.listen(0, '127.0.0.1', () => console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`))
}
else {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line)
    if (flavor === 'codex') {
      const reply = result => send({ id: m.id, result })
      if (m.method === 'initialize')
        reply({})
      if (m.method === 'skills/list')
        reply({ data: [{ cwd: process.cwd(), skills: [{ name: 'test-skill', description: 'Test skill', path: `${process.cwd()}/SKILL.md`, enabled: true }] }] })
      if (m.method === 'thread/start' || m.method === 'thread/resume') {
        if (m.params.threadId && m.params.threadId !== sessionId)
          send({ id: m.id, error: { code: -32602, message: 'Unknown thread' } })
        else reply({ thread: { id: sessionId, cwd: process.cwd() } })
      }
      if (m.method === 'turn/start') {
        reply({ turn: { id: 'turn-native' } })
        const skill = m.params.input.find(part => part.type === 'skill')
        handlePrompt(skill ? `echo:${JSON.stringify(m.params.input)}` : m.params.input[0].text)
      }
      if (m.method === 'turn/interrupt') {
        reply({})
        send({ method: 'turn/completed', params: { threadId: sessionId, turn: { id: 'turn-native', status: 'interrupted' } } })
      }
      if (m.id === 'approval')
        complete(m.result.decision === 'accept' ? 'ALLOWED' : 'DENIED')
    }
    if (flavor === 'acp') {
      const reply = result => send({ jsonrpc: '2.0', id: m.id, result })
      if (m.method === 'initialize') {
        reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } })
      }
      else if (m.method === 'session/new') {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review code' }] } } })
        reply({ sessionId, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Ask' }] } })
      }
      else if (m.method === 'session/load') {
        if (m.params.sessionId !== sessionId)
          send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Missing native session' } })
        else
          reply({})
      }
      else if (m.method === 'session/set_mode') {
        reply({})
      }
      else if (m.method === 'session/prompt') {
        promptRequest = m.id
        handlePrompt(m.params.prompt[0].text)
      }
      else if (m.method === 'session/cancel') {
        send({ jsonrpc: '2.0', id: promptRequest, result: { stopReason: 'cancelled' } })
      }
      else if (m.id === 'approval') {
        complete(m.result.outcome.outcome === 'cancelled' ? 'DENIED' : m.result.outcome.optionId)
      }
    }
    if (flavor === 'pi') {
      const response = data => send({ type: 'response', id: m.id, success: true, data })
      if (m.type === 'get_state') {
        response({ sessionId, sessionFile: '/native/session.jsonl' })
      }
      else if (m.type === 'get_commands') {
        response({ commands: [{ name: 'skill:test-skill', description: 'Test skill', source: 'skill' }, { name: 'review', source: 'prompt' }, { name: 'extension-command', source: 'extension' }] })
      }
      else if (m.type === 'prompt') {
        response({})
        handlePrompt(m.message)
      }
      else if (m.type === 'abort') {
        send({ type: 'agent_end' })
        response({})
      }
      else {
        response({})
      }
    }
    if (flavor === 'claude') {
      if (m.type === 'control_request') {
        send({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: m.request.subtype === 'initialize' ? { commands: [{ name: 'review', description: 'Review code' }, { name: 'test-skill', description: 'Test skill', source: 'skill' }, { name: 'hooks' }] } : {} } })
        if (m.request.subtype === 'interrupt')
          send({ type: 'result', session_id: sessionId, is_error: false })
      }
      if (m.type === 'user')
        handlePrompt(m.message.content)
      if (m.type === 'control_response')
        complete(m.response.response.behavior === 'allow' ? 'ALLOWED' : 'DENIED')
    }
  })
}
