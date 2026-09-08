<script setup lang="ts">
import type { ToolCall } from '../schema'
import { VueLoadingIndicator } from '@vue/devtools-ui'
import { computed } from 'vue'
import { toolGroupStatus } from './tool-groups'

const props = defineProps<{ tools: ToolCall[] }>()
const status = computed(() => toolGroupStatus(props.tools))
const labels: Record<ToolCall['status'], string> = {
  pending: '等待执行',
  running: '执行中',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
}
const completed = computed(() => props.tools.filter(tool => tool.status === 'completed').length)
const statusLabel = computed(() => labels[status.value] + (status.value === 'running' ? ` ${completed.value}/${props.tools.length}` : ''))
</script>

<template>
  <details class="acp-tools acp-tool-group" :data-status="status">
    <summary class="acp-tool-group-summary">
      <span class="acp-tool-chevron" i-carbon-chevron-right aria-hidden="true" />
      <span class="acp-tool-group-icon" aria-hidden="true">
        <VueLoadingIndicator v-if="status === 'running'" />
        <span v-else i-carbon-tool-box />
      </span>
      <span class="acp-tool-group-title">执行过程</span>
      <span class="acp-tool-group-count">{{ tools.length }} 项调用</span>
      <span class="acp-tool-group-status" role="status">{{ statusLabel }}</span>
    </summary>
    <ol class="acp-tool-group-items">
      <li v-for="tool in tools" :key="tool.id" class="acp-tool" :data-tool-id="tool.id" :data-status="tool.status">
        <div class="acp-tool-row">
          <span class="acp-tool-title">{{ tool.title }}</span>
          <span class="acp-tool-status">{{ labels[tool.status] }}</span>
        </div>
        <pre v-if="tool.input !== undefined">{{ JSON.stringify(tool.input, null, 2) }}</pre>
        <pre v-if="tool.output !== undefined">{{ JSON.stringify(tool.output, null, 2) }}</pre>
      </li>
    </ol>
  </details>
</template>
