import type { AgentMessagePart, ToolCall } from '@vue/devtools-acp'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { groupMessageTools, toolGroupStatus } from '../../src/ui/tool-groups'
import ToolCallGroup from '../../src/ui/ToolCallGroup.vue'

const tool = (id: string, status: ToolCall['status'] = 'completed'): ToolCall => ({ id, title: `cat src/${id}.vue`, status })
describe('message tool groups', () => {
  it('merges adjacent calls without moving intervening message text', () => {
    const parts: AgentMessagePart[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool', tool: tool('a') },
      { type: 'tool', tool: tool('b') },
      { type: 'text', text: 'Middle' },
      { type: 'tool', tool: tool('c') },
      { type: 'text', text: 'After' },
    ]
    const groups = groupMessageTools(parts)
    expect(groups.map(part => part.type)).toEqual(['text', 'tools', 'text', 'tools', 'text'])
    expect(groups[1]).toMatchObject({ key: 'tools:a', tools: [tool('a'), tool('b')] })
    expect(parts).toHaveLength(6)
  })
  it('reports progress and terminal outcomes without claiming incomplete calls completed', () => {
    expect(toolGroupStatus([tool('a'), tool('b', 'running')])).toBe('running')
    expect(toolGroupStatus([tool('a', 'failed'), tool('b', 'pending')])).toBe('pending')
    expect(toolGroupStatus([tool('a'), tool('b', 'failed')])).toBe('failed')
    expect(toolGroupStatus([tool('a'), tool('b', 'cancelled')])).toBe('cancelled')
    expect(toolGroupStatus([tool('a'), tool('b')])).toBe('completed')
  })
  it('uses one initially closed disclosure with a fixed title and preserves it during updates', async () => {
    const wrapper = mount(ToolCallGroup, { props: { tools: [tool('a'), tool('b', 'running')] } })
    try {
      expect(wrapper.findAll('details')).toHaveLength(1)
      expect(wrapper.attributes('open')).toBeUndefined()
      expect(wrapper.find('summary').text()).toContain('执行过程')
      expect(wrapper.find('summary').text()).toContain('2 项调用')
      expect(wrapper.find('summary').text()).toContain('执行中 1/2')
      expect(wrapper.find('summary').text()).not.toContain('cat src/')
      wrapper.element.setAttribute('open', '')
      await wrapper.setProps({ tools: [tool('a'), tool('b'), tool('c')] })
      expect(wrapper.attributes('open')).toBe('')
      expect(wrapper.find('summary').text()).toContain('3 项调用')
      expect(wrapper.find('summary').text()).toContain('已完成')
      expect(wrapper.findAll('[data-tool-id]').map(row => row.attributes('data-tool-id'))).toEqual(['a', 'b', 'c'])
    }
    finally { wrapper.unmount() }
  })
})
