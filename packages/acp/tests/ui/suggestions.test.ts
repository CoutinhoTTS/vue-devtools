import type { ComposerCommand } from '@vue/devtools-acp'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { completionRows, newCommand } from '../../src/ui/composer-completion'
import ComposerSuggestions from '../../src/ui/ComposerSuggestions.vue'

const skill: ComposerCommand = { id: 'codex:skill:review', name: 'review', description: 'Do not show this skill description', source: 'codex', kind: 'skill', scope: 'skill', execution: 'native' }
const command: ComposerCommand = { ...skill, id: 'codex:command:check', name: 'check', description: 'Check changes', kind: 'command', scope: 'builtin' }

describe('grouped composer suggestions', () => {
  it('groups unfiltered entries and hides skill descriptions and per-row sources', async () => {
    const rows = completionRows({ kind: 'command', query: '', start: 0, end: 1 }, [skill, command, newCommand], [])
    const wrapper = mount(ComposerSuggestions, { props: { id: 'suggestions', rows, selected: 0, status: '', loading: false } })
    try {
      expect(wrapper.findAll('[role="group"]').map(group => group.find('.acp-suggestion-heading').text())).toEqual(['Application', 'Agent Commands', 'Skills'])
      expect(wrapper.findAll('[role="option"] strong').map(option => option.text())).toEqual(['/new', '/check', '/review'])
      expect(wrapper.find('#suggestions-2 .acp-suggestion-icon').classes()).toContain('i-griddy-icons-package')
      expect(wrapper.find('#suggestions-0 .acp-suggestion-icon').classes()).toContain('i-lucide-slash')
      expect(wrapper.find('#suggestions-1 .acp-suggestion-icon').classes()).toContain('i-lucide-slash')
      expect(wrapper.text()).not.toContain(skill.description)
      expect(wrapper.text()).not.toContain('codex / skill')
      expect(wrapper.text()).toContain('Check changes')
      const scroll = vi.fn()
      Object.defineProperty(wrapper.find('#suggestions-2').element, 'scrollIntoView', { value: scroll })
      await wrapper.setProps({ selected: 2 })
      await flushPromises()
      expect(wrapper.find('[aria-selected="true"]').attributes('id')).toBe('suggestions-2')
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
      await wrapper.find('#suggestions-2').trigger('click')
      expect(wrapper.emitted('accept')).toEqual([[2]])
    }
    finally { wrapper.unmount() }
  })
  it('keeps the most relevant search group first and filters out empty groups', () => {
    const rows = completionRows({ kind: 'command', query: 'review', start: 0, end: 7 }, [newCommand, command, skill], [])
    expect(rows[0]).toEqual({ kind: 'command', command: skill })
    const wrapper = mount(ComposerSuggestions, { props: { id: 'filtered', rows, selected: 0, status: '', loading: false } })
    try {
      expect(wrapper.findAll('[role="group"]')).toHaveLength(1)
      expect(wrapper.find('.acp-suggestion-heading').text()).toBe('Skills')
    }
    finally { wrapper.unmount() }
  })
})
