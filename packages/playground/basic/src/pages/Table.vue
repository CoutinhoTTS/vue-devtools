<script setup lang="ts">
import { ElCheckbox, ElInput, ElTable, ElTableColumn } from 'element-plus'
import { useTableConfig } from './hooks/useTableConfig'

const { query, showEmail, stripe, tableConfig } = useTableConfig()
</script>

<template>
  <section class="table-page">
    <h1>Table</h1>
    <div class="table-toolbar">
      <ElInput
        v-model="query"
        class="table-search"
        v-bind="{ ariaLabel: 'Search users' }"
        placeholder="Search users"
        clearable
      />
      <ElCheckbox :model-value="showEmail" @update:model-value="showEmail = $event === true">
        Email column
      </ElCheckbox>
      <ElCheckbox :model-value="stripe" @update:model-value="stripe = $event === true">
        Striped rows
      </ElCheckbox>
      <span class="table-count" role="status">
        {{ tableConfig.props.data.length }} {{ tableConfig.props.data.length === 1 ? 'user' : 'users' }}
      </span>
    </div>
    <ElTable v-bind="tableConfig.props">
      <ElTableColumn
        v-for="column in tableConfig.columns"
        :key="column.prop"
        v-bind="column"
      />
    </ElTable>
  </section>
</template>

<style scoped>
.table-page {
  max-width: 1040px;
  min-width: 0;
  margin: 24px auto;
  padding: 0 16px;
  text-align: left;
}

.table-page h1 {
  margin: 0 0 16px;
  font-size: 24px;
  line-height: 32px;
}

.table-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 16px;
}

.table-search {
  width: 280px;
  max-width: 100%;
}

.table-toolbar :deep(.el-checkbox) {
  margin-right: 0;
  color: inherit;
}

.table-count {
  margin-left: auto;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
</style>
