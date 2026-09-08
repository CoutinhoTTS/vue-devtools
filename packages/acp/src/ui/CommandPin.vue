<script setup lang="ts">
import type { ComposerSelection } from '../schema'

defineProps<{ command: ComposerSelection }>()
</script>

<template>
  <span class="acp-command-pin" :title="(command.kind === 'skill' ? 'Skill: /' : 'Command: /') + command.name">
    <span class="i-lucide-pin acp-pin-icon" aria-hidden="true" />
    <span class="acp-pin-label">{{ command.name }}</span>
  </span>
</template>
