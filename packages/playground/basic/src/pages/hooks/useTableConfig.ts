import { computed, ref } from 'vue'

export interface TableRow {
  id: number
  name: string
  email: string
  role: string
  status: 'Active' | 'Inactive'
}

export interface TableColumn {
  prop: keyof TableRow
  label: string
  width?: number
  minWidth?: number
  sortable?: boolean
}

export interface TableConfig {
  props: {
    data: TableRow[]
    rowKey: keyof TableRow
    border: boolean
    stripe: boolean
    emptyText: string
  }
  columns: TableColumn[]
}

export function useTableConfig() {
  const query = ref('')
  const showEmail = ref(true)
  const stripe = ref(true)
  const rows = ref<TableRow[]>([
    { id: 1, name: 'Alice Chen', email: 'alice@example.com', role: 'Admin', status: 'Active' },
    { id: 2, name: 'Ben Wang', email: 'ben@example.com', role: 'Editor', status: 'Active' },
    { id: 3, name: 'Clara Liu', email: 'clara@example.com', role: 'Viewer', status: 'Inactive' },
    { id: 4, name: 'David Zhang', email: 'david@example.com', role: 'Editor', status: 'Active' },
    { id: 5, name: 'Emma Li', email: 'emma@example.com', role: 'Viewer', status: 'Active' },
    { id: 6, name: 'Frank Wu', email: 'frank@example.com', role: 'Admin', status: 'Inactive' },
  ])

  const tableConfig = computed<TableConfig>(() => {
    const keyword = query.value.trim().toLowerCase()
    const columns: TableColumn[] = [
      { prop: 'id', label: 'ID', width: 80, sortable: true },
      { prop: 'name', label: 'Name', minWidth: 160, sortable: true },
      { prop: 'email', label: 'Email', minWidth: 240 },
      { prop: 'role', label: 'Role', minWidth: 120, sortable: true },
      { prop: 'status', label: 'Status', minWidth: 120 },
    ]

    return {
      props: {
        data: rows.value.filter(row => Object.values(row).some(value => String(value).toLowerCase().includes(keyword))),
        rowKey: 'id',
        border: true,
        stripe: stripe.value,
        emptyText: 'No matching users',
      },
      columns: columns.filter(column => showEmail.value || column.prop !== 'email'),
    }
  })

  return { query, showEmail, stripe, rows, tableConfig }
}
