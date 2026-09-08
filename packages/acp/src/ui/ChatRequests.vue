<script setup lang="ts">
import type { PermissionRequest, PermissionResponse, UserInputRequest, UserInputResponse } from '../schema'
import { VueButton, VueInput } from '@vue/devtools-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{ permission?: PermissionRequest, question?: UserInputRequest, pending?: boolean, error?: string, connected: boolean }>()
const emit = defineEmits<{ permission: [response: PermissionResponse], answer: [response: UserInputResponse] }>()
const answers = ref<Record<string, { optionIds: string[], text: string }>>({})
watch(() => props.question?.id, () => {
  answers.value = Object.fromEntries((props.question?.questions ?? []).map(q => [q.id, { optionIds: [], text: '' }]))
}, { immediate: true })
const ready = computed(() => props.question?.questions.every(q => answers.value[q.id]?.optionIds.length || answers.value[q.id]?.text.trim()))
function choose(id: string, value: string, multiple: boolean) {
  const answer = answers.value[id]
  if (!answer || props.pending || !props.connected)
    return
  answer.optionIds = multiple ? answer.optionIds.includes(value) ? answer.optionIds.filter(v => v !== value) : [...answer.optionIds, value] : [value]
}
function submit() {
  if (!props.question || !ready.value || props.pending || !props.connected)
    return
  emit('answer', { requestId: props.question.id, outcome: 'answered', answers: Object.entries(answers.value).map(([questionId, answer]) => ({ questionId, optionIds: answer.optionIds, ...(answer.text.trim() ? { text: answer.text.trim() } : {}) })) })
}
</script>

<template>
  <section v-if="permission || question" class="acp-request" aria-label="Agent request">
    <template v-if="permission">
      <h3><span i-carbon-security aria-hidden="true" />{{ permission.title }}</h3>
      <p>{{ permission.detail }}</p>
      <div class="acp-request-actions">
        <VueButton v-for="option in permission.options" :key="option.id" :disabled="pending || !connected" :type="option.kind.startsWith('deny') ? 'default' : 'primary'" @click="emit('permission', { requestId: permission.id, outcome: 'selected', optionId: option.id })">
          {{ option.label }}
        </VueButton>
      </div>
    </template>
    <form v-else-if="question" @submit.prevent="submit">
      <fieldset v-for="q in question.questions" :key="q.id" :disabled="pending || !connected">
        <legend>{{ q.prompt }}</legend>
        <label v-for="option in q.options" :key="option.id" class="acp-answer-option">
          <input :type="q.multiple ? 'checkbox' : 'radio'" :name="question.id + q.id" :checked="answers[q.id]?.optionIds.includes(option.id)" @change="choose(q.id, option.id, q.multiple)">
          {{ option.label }}
        </label>
        <VueInput v-if="q.allowText && answers[q.id]" v-model="answers[q.id].text" :disabled="pending || !connected" placeholder="Your answer" />
      </fieldset>
      <div class="acp-request-actions">
        <VueButton :disabled="pending || !connected" @click.prevent="emit('answer', { requestId: question.id, outcome: 'cancelled' })">
          Cancel
        </VueButton>
        <VueButton type="primary" :disabled="!ready || pending || !connected" @click.prevent="submit">
          Submit
        </VueButton>
      </div>
    </form>
    <p v-if="pending" role="status">
      Submitting...
    </p>
    <p v-if="error" role="alert" class="acp-error-text">
      {{ error }}
    </p>
  </section>
</template>
