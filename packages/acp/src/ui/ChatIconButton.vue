<script setup lang="ts">
import { VueButton, VueTooltip } from '@vue/devtools-ui'

defineProps<{ label: string, icon: string, disabled?: boolean, ariaExpanded?: boolean, ariaPressed?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <VueTooltip>
    <VueButton flat class="acp-icon-button" :aria-label="label" :aria-expanded="ariaExpanded" :aria-pressed="ariaPressed" :title="label" :disabled="disabled" @click="$emit('click')">
      <template #icon>
        <span :class="icon" aria-hidden="true" />
      </template>
    </VueButton>
    <template #popper>
      {{ label }}
    </template>
  </VueTooltip>
</template>
