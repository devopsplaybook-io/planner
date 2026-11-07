<template>
  <div class="ask-panel">
    <form class="ask-form" @submit.prevent="submit">
      <label class="ask-question">
        <span>Ask about your tasks and notes</span>
        <textarea
          ref="questionInput"
          v-model="question"
          rows="3"
          :maxlength="MAX_QUESTION_LENGTH"
          placeholder="What is due today? Summarize project Website."
        />
      </label>
      <div class="ask-actions">
        <InlineDictationButton
          :target="targetQuestion"
          aria-label="Dictate your question"
          :project-id="projectId || null"
        />
        <select
          v-if="projects.length > 0"
          v-model="projectId"
          class="ask-project"
          aria-label="Question project scope"
        >
          <option value="">All projects</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
        <button type="submit" :disabled="!question.trim() || loading" :aria-busy="loading">
          Ask
        </button>
      </div>
    </form>

    <p class="ask-hint">
      <i class="bi bi-eye" /> Read-only: questions never change your data.
    </p>

    <p v-if="loading" class="ask-loading" role="status">
      <span class="inline-spinner" aria-hidden="true" /> Looking up your data…
    </p>
    <p v-if="error" class="ask-error" role="alert">{{ error }}</p>

    <div v-if="answer" class="ask-answer" aria-live="polite">
      <p class="ask-text">{{ answer.answer }}</p>
      <ul v-if="answer.items.length > 0" class="ask-items">
        <li v-for="item in answer.items" :key="`${item.kind}:${item.id}`">
          <a :href="item.kind === 'task' ? `/tasks/${item.id}` : `/notes/${item.id}`">
            {{ item.title }}
          </a>
          <span v-if="item.projectName" class="ask-item-project">
            · {{ item.projectName }}
          </span>
        </li>
      </ul>
      <p v-if="answer.truncated" class="ask-source">
        Some results are not shown: refine the question to narrow them down.
      </p>
      <p class="ask-source">
        {{ answer.generatedBy === "llm" ? "Rephrased by AI from your data." : "Computed from your data." }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";

const MAX_QUESTION_LENGTH = 500;

const props = defineProps({
  answer: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  projects: { type: Array, default: () => [] },
});

const emit = defineEmits(["ask"]);

const question = ref("");
const projectId = ref("");
const questionInput = ref(null);

function targetQuestion() {
  return questionInput.value;
}

function submit() {
  const text = question.value.trim();
  if (!text || props.loading) {
    return;
  }
  emit("ask", {
    question: text.slice(0, MAX_QUESTION_LENGTH),
    projectId: projectId.value || null,
  });
}
</script>

<style scoped>
.ask-panel {
  display: grid;
  gap: var(--space-sm);
}

.ask-form {
  display: grid;
  gap: var(--space-2xs);
}

.ask-question {
  display: grid;
  gap: 2px;
  font-size: var(--text-sm);
}

.ask-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.ask-project {
  width: auto;
  margin: 0;
}

.ask-hint,
.ask-loading {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.8;
}

.ask-error {
  margin: 0;
  color: #842029;
  font-size: var(--text-sm);
}

.ask-answer {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.ask-text {
  margin: 0;
  white-space: pre-wrap;
}

.ask-items {
  margin: 0;
  padding-left: var(--space-md);
}

.ask-item-project {
  opacity: 0.7;
}

.ask-source {
  margin: 0;
  font-size: var(--text-xs);
  opacity: 0.7;
}
</style>
