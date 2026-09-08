import { flushPromises, mount } from '@vue/test-utils'
import { ElTable } from 'element-plus'
import { describe, expect, it } from 'vitest'
import Table from './Table.vue'

describe('table page', () => {
  it('consumes reactive data, columns, and props from the configuration', async () => {
    const wrapper = mount(Table)

    try {
      await flushPromises()
      expect(wrapper.findAll('.el-table__row')).toHaveLength(6)
      expect(wrapper.findAll('th').map(column => column.text())).toEqual(['ID', 'Name', 'Email', 'Role', 'Status'])
      expect(wrapper.getComponent(ElTable).props('stripe')).toBe(true)

      await wrapper.get('input[aria-label="Search users"]').setValue('alice')
      expect(wrapper.findAll('.el-table__row')).toHaveLength(1)
      expect(wrapper.get('[role="status"]').text()).toBe('1 user')

      const checkboxes = wrapper.findAll('input[type="checkbox"]')
      await checkboxes[0].setValue(false)
      await flushPromises()
      expect(wrapper.findAll('th').map(column => column.text())).toEqual(['ID', 'Name', 'Role', 'Status'])

      await checkboxes[1].setValue(false)
      expect(wrapper.getComponent(ElTable).props('stripe')).toBe(false)

      await wrapper.get('input[aria-label="Search users"]').setValue('missing')
      expect(wrapper.findAll('.el-table__row')).toHaveLength(0)
      expect(wrapper.text()).toContain('No matching users')

      await wrapper.get('input[aria-label="Search users"]').setValue('')
      await checkboxes[0].setValue(true)
      await flushPromises()
      expect(wrapper.findAll('.el-table__row')).toHaveLength(6)
      expect(wrapper.findAll('th')).toHaveLength(5)
    }
    finally {
      wrapper.unmount()
    }
  })
})
