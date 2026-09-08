import { describe, expect, it } from 'vitest'
import { isReadonly, isRef } from 'vue'
import { useTableConfig } from './useTableConfig'

describe('useTableConfig', () => {
  it('provides a computed, JSON-serializable table configuration', () => {
    const { tableConfig, rows } = useTableConfig()

    expect(isRef(tableConfig)).toBe(true)
    expect(isReadonly(tableConfig)).toBe(true)
    expect(JSON.parse(JSON.stringify(tableConfig.value))).toEqual(tableConfig.value)
    expect(tableConfig.value.props.data).toEqual(rows.value)
    expect(tableConfig.value.props.rowKey).toBe('id')
    expect(tableConfig.value.columns.map(column => column.prop)).toEqual(['id', 'name', 'email', 'role', 'status'])
  })

  it('updates column visibility and table props reactively', () => {
    const { tableConfig, showEmail, stripe } = useTableConfig()

    expect(tableConfig.value.props.stripe).toBe(true)
    expect(tableConfig.value.columns).toHaveLength(5)

    showEmail.value = false
    stripe.value = false

    expect(tableConfig.value.props.stripe).toBe(false)
    expect(tableConfig.value.columns.map(column => column.prop)).toEqual(['id', 'name', 'role', 'status'])

    showEmail.value = true
    expect(tableConfig.value.columns[2].prop).toBe('email')
  })

  it.each([
    ['  ALICE  ', [1]],
    ['ben@example.com', [2]],
    ['editor', [2, 4]],
    ['inactive', [3, 6]],
    ['missing', []],
    ['   ', [1, 2, 3, 4, 5, 6]],
  ])('filters rows for %j', (keyword, ids) => {
    const { tableConfig, query, rows } = useTableConfig()
    query.value = keyword

    expect(tableConfig.value.props.data.map(row => row.id)).toEqual(ids)
    expect(rows.value).toHaveLength(6)
  })

  it('reacts to row changes and keeps hook instances independent', () => {
    const { tableConfig, rows, query } = useTableConfig()
    const other = useTableConfig()
    query.value = 'updated'
    expect(tableConfig.value.props.data).toEqual([])

    rows.value[0].name = 'Updated user'
    expect(tableConfig.value.props.data.map(row => row.id)).toEqual([1])
    expect(other.rows.value[0].name).toBe('Alice Chen')
    expect(other.query.value).toBe('')

    rows.value = []
    expect(tableConfig.value.props.data).toEqual([])
  })
})
