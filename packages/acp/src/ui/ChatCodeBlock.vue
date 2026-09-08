<script setup lang="ts">
import type { VueCodeBlockProps } from '@vue/devtools-ui'
import type { CodeBlockNodeProps } from 'markstream-vue'
import { VueCodeBlock } from '@vue/devtools-ui'
import { computed } from 'vue'

const props = defineProps<Pick<CodeBlockNodeProps, 'node' | 'isDark'>>()
const language = computed(() => (props.node.language?.trim().split(/\s+/, 1)[0].toLowerCase() || 'text') as VueCodeBlockProps['lang'])
</script>

<template>
  <div class="acp-code-block" :data-theme="isDark ? 'dark' : 'light'">
    <VueCodeBlock :code="node.code" :lang="language" :lines="false" />
  </div>
</template>
