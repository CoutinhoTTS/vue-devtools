<script setup lang="ts">
import claude from './assets/agents/claude.svg'
import codex from './assets/agents/codex.svg'
import grok from './assets/agents/grok.svg'
import kimi from './assets/agents/kimi.svg'
import openCode from './assets/agents/openCode.svg'
import pi from './assets/agents/pi.svg'

defineProps<{ provider: string }>()

// Iconify: fa7-brands:openai, codicon:kimi, material-icon-theme:{claude,opencode-light}, selfhst:grok-dark. Pi supplied by the user.
const icons: Record<string, string> = { claude, codex, grok, kimi, openCode, pi }
const colorIcons = new Set(['claude', 'openCode'])
</script>

<template>
  <img v-if="colorIcons.has(provider)" class="acp-agent-icon" :src="icons[provider]" alt="" aria-hidden="true">
  <span v-else class="acp-agent-icon" :class="{ 'i-carbon-bot': !icons[provider] }" :style="icons[provider] ? { maskImage: `url(${JSON.stringify(icons[provider])})`, backgroundColor: 'currentColor' } : undefined" aria-hidden="true" />
</template>

<style scoped>
.acp-agent-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  object-fit: contain;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}
</style>
