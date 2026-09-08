<script setup lang="ts">
import type { CompletionRow } from './composer-completion'
import { computed, nextTick, ref, watch } from 'vue'
import ChatIconButton from './ChatIconButton.vue'
import { completionGroup, completionGroupLabels } from './composer-completion'

const props = defineProps<{ id: string, rows: CompletionRow[], selected: number, status: string, loading: boolean }>()
const emit = defineEmits<{ accept: [index: number], select: [index: number], retry: [] }>()
const list = ref<HTMLElement>()
const groups = computed(() => {
  const result: { key: keyof typeof completionGroupLabels, options: { row: CompletionRow, index: number }[] }[] = []
  props.rows.forEach((row, index) => {
    const key = completionGroup(row)
    let group = result.find(group => group.key === key)
    if (!group) {
      group = { key, options: [] }
      result.push(group)
    }
    group.options.push({ row, index })
  })
  return result
})
watch(() => props.selected, async () => {
  await nextTick()
  list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
})
</script>

<template>
  <div class="acp-suggestions" @mousedown.prevent>
    <div v-if="status" class="acp-suggestion-status" role="status">
      <span>{{ status }}</span>
      <ChatIconButton v-if="!loading" label="Refresh suggestions" icon="i-carbon-renew" @click="emit('retry')" />
    </div>
    <div :id="id" ref="list" class="acp-suggestion-list" role="listbox" aria-label="Suggestions">
      <div v-for="group in groups" :key="group.key" role="group" :aria-labelledby="`${id}-${group.key}-heading`">
        <div :id="`${id}-${group.key}-heading`" class="acp-suggestion-heading">
          {{ completionGroupLabels[group.key] }}
        </div>
        <div v-for="{ row, index } in group.options" :id="`${id}-${index}`" :key="row.kind === 'command' ? row.command.id : row.kind === 'component' ? row.component.instanceToken : row.file.path" role="option" class="acp-suggestion-option" :aria-selected="index === selected" :class="{ selected: index === selected }" @mouseenter="emit('select', index)" @click="emit('accept', index)">
          <span :class="row.kind === 'component' ? 'i-lucide-box' : row.kind === 'file' ? row.file.isDirectory ? 'i-carbon-folder' : 'i-carbon-document' : row.command.kind === 'skill' ? 'i-griddy-icons-package' : 'i-lucide-slash'" class="acp-suggestion-icon" aria-hidden="true" />
          <div class="acp-suggestion-copy">
            <strong>{{ row.kind === 'command' ? `/${row.command.name}` : row.kind === 'component' ? `<${row.component.name}>` : row.file.path }}</strong>
            <small v-if="row.kind === 'component'" :title="row.component.file">{{ row.component.parentPath || 'Root' }} · {{ row.component.id }}</small>
            <small v-if="row.kind === 'command' && row.command.kind !== 'skill' && row.command.description">{{ row.command.description }}</small>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
