<script setup lang="ts">
import type { ChatSession } from './types'
import { VueButton } from '@vue/devtools-ui'
import AgentIcon from './AgentIcon.vue'
import { isRunning } from './types'

defineProps<{ sessions: ChatSession[], selectedId: string | null }>()
defineEmits<{ select: [id: string], newChat: [] }>()
</script>

<template>
  <nav class="acp-session-list" aria-label="Conversations">
    <div class="acp-sidebar-heading">
      <span>Conversations</span>
      <VueButton flat class="acp-icon-button" aria-label="New conversation" title="New conversation" @click="$emit('newChat')">
        <template #icon>
          <span i-carbon-add aria-hidden="true" />
        </template>
      </VueButton>
    </div>
    <ul class="acp-session-items">
      <li v-for="session in sessions" :key="session.id">
        <div role="button" class="acp-session-item" :class="{ selected: session.id === selectedId }" :aria-current="session.id === selectedId ? 'page' : undefined" :title="session.title || 'Untitled conversation'" @mousedown.prevent @click="$emit('select', session.id)">
          <AgentIcon :provider="session.provider" />
          <span class="acp-session-title">{{ session.title || 'Untitled conversation' }}</span>
          <span v-if="isRunning(session.status)" class="acp-session-status" role="img" :aria-label="session.status === 'waiting' ? 'Waiting' : 'Running'" :title="session.status === 'waiting' ? 'Waiting' : 'Running'">
            <span v-if="session.status === 'waiting'" i-carbon-time aria-hidden="true" />
            <span v-else i-carbon-circle-dash aria-hidden="true" />
          </span>
          <span v-else-if="session.status === 'failed'" class="acp-session-status acp-error-text" role="img" aria-label="Failed" title="Failed">
            <span i-carbon-warning-alt aria-hidden="true" />
          </span>
        </div>
      </li>
    </ul>
    <p v-if="!sessions.length" class="acp-list-empty">
      No conversations
    </p>
  </nav>
</template>
