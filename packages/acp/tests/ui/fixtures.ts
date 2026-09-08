import type { ChatProvider, ChatSession } from '../../src/ui/types'

export const providers: ChatProvider[] = [
  { id: 'kimi', modelControl: 'available', effortControl: 'available', models: [
    { id: 'model-a', name: 'Model A', isDefault: true, reasoningEfforts: ['low', 'high'] },
    { id: 'model-b', name: 'Model B', isDefault: false, reasoningEfforts: ['medium'] },
  ] },
  { id: 'pi', modelControl: 'available', effortControl: 'unsupported', models: [{ id: 'model-pi', name: 'Pi model', isDefault: true, reasoningEfforts: [] }] },
]
export function fixtureSessions(): ChatSession[] {
  const sessions: ChatSession[] = [
    { id: 'a', title: 'Inspect component state', provider: 'kimi', options: { mode: 'ask', model: 'model-a', reasoningEffort: 'high' }, status: 'idle', messages: [
      { id: 'u1', turnId: 't1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'Why is the selected item not updating?' }] },
      { id: 'a1', turnId: 't1', role: 'assistant', createdAt: 2, content: [{ type: 'text', text: 'The selected item is stored separately from the list.\n\n### Check the component state\n\n- Confirm the selected ID.\n- Compare it with the current list.\n\nUse **one source of truth** for the selected item.' }] },
    ], tools: [{ id: 'tool1', title: 'Inspect selected component', status: 'completed', input: { componentId: 'app:3' }, output: { selectedId: 42 } }] },
    { id: 'b', title: 'Investigate a very long router navigation title that should never resize the session sidebar', provider: 'pi', options: { mode: 'ask', model: 'model-pi', reasoningEffort: null }, status: 'working', messages: [
      { id: 'a2', turnId: 't2', role: 'assistant', createdAt: 3, streaming: true, content: [{ type: 'text', text: 'Checking navigation guards...' }] },
    ] },
  ]
  const message = sessions[0].messages[1]
  message.parts = [
    { type: 'tool', tool: { ...sessions[0].tools![0], turnId: message.turnId, messageId: message.id } },
    { type: 'text', text: message.content[0].type === 'text' ? message.content[0].text : '' },
  ]
  return sessions
}
