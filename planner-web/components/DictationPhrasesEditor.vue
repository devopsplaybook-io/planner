<template>
  <div class="phrases-editor">
    <p class="phrases-count" aria-live="polite">
      {{ phrasesStore.count }} / {{ phrasesMax }} phrases
    </p>

    <form class="phrases-add" @submit.prevent="addPhrase">
      <label>
        Spoken phrase
        <input
          v-model="newPhrase"
          type="text"
          placeholder="e.g. new bug report"
          aria-label="New command phrase"
          :maxlength="PHRASE_MAX_LENGTH"
        >
      </label>
      <label>
        Target
        <select v-model="targetType" aria-label="Phrase target type">
          <option value="project">Create a task in a project</option>
          <option value="template">Instantiate a template</option>
        </select>
      </label>
      <label v-if="targetType === 'project'">
        Project
        <select v-model="targetId" aria-label="Phrase project">
          <option value="">Select a project</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label v-else>
        Template
        <select v-model="targetId" aria-label="Phrase template">
          <option value="">Select a template</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">
            {{ template.title }}
          </option>
        </select>
      </label>
      <label v-if="targetType === 'project'">
        Labels (comma separated)
        <input
          v-model="labelsText"
          type="text"
          placeholder="bug, triage"
          aria-label="Phrase labels"
        >
      </label>
      <button
        type="submit"
        :disabled="!canSubmit || saving || atLimit"
        :aria-busy="saving"
      >
        Add phrase
      </button>
    </form>

    <ul v-if="phrasesStore.phrases.length > 0" class="phrases-list">
      <li v-for="phrase in phrasesStore.phrases" :key="phrase.id" class="phrase-item">
        <div class="phrase-info">
          <span class="phrase-text">“{{ phrase.phrase }}”</span>
          <span class="phrase-target">{{ targetLabel(phrase) }}</span>
          <span v-if="phrase.labels.length > 0" class="phrase-labels">
            {{ phrase.labels.join(", ") }}
          </span>
        </div>
        <button
          type="button"
          class="phrase-remove"
          :aria-label="`Remove ${phrase.phrase}`"
          :disabled="saving"
          @click="removePhrase(phrase)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-else class="setting-hint">
      No phrases yet. A phrase applies deterministically before the AI: the
      rest of the dictation becomes the task title and description.
    </p>

    <p
      v-if="feedback"
      class="phrases-feedback"
      :class="{ 'is-error': feedbackIsError }"
      role="status"
      aria-live="polite"
    >
      {{ feedback }}
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

const PHRASE_MAX_LENGTH = 100;

const phrasesStore = useDictationPhrasesStore();
const projectsStore = useProjectsStore();
const templatesStore = useTaskTemplatesStore();
const recommendationStore = useRecommendationStore();

const newPhrase = ref("");
const targetType = ref("project");
const targetId = ref("");
const labelsText = ref("");
const saving = ref(false);
const feedback = ref("");
const feedbackIsError = ref(false);

const phrasesMax = computed(
  () => recommendationStore.dictationPhrasesMax,
);
const projects = computed(() => projectsStore.activeProjects || []);
const templates = computed(() => templatesStore.templates || []);
const atLimit = computed(() => phrasesStore.count >= phrasesMax.value);
const canSubmit = computed(
  () => !!newPhrase.value.trim() && !!targetId.value,
);

function setFeedback(message, isError = false) {
  feedback.value = message;
  feedbackIsError.value = isError;
}

function projectName(projectId) {
  return projectsStore.projects.find((project) => project.id === projectId)?.name || "";
}

function targetLabel(phrase) {
  if (phrase.templateId) {
    const template = templates.value.find(
      (entry) => entry.id === phrase.templateId,
    );
    return `Template: ${template?.title || phrase.templateId}`;
  }
  return `Project: ${projectName(phrase.projectId) || phrase.projectId || "unknown"}`;
}

async function load() {
  await Promise.all([
    phrasesStore.fetchAll().catch(() => undefined),
    projectsStore.fetchAll().catch(() => undefined),
    templatesStore.fetchAll().catch(() => undefined),
  ]);
  if (phrasesStore.error) {
    setFeedback(phrasesStore.error, true);
  }
}

async function addPhrase() {
  if (!canSubmit.value) {
    return;
  }
  saving.value = true;
  setFeedback("");
  const labels = labelsText.value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const input = {
    phrase: newPhrase.value.trim(),
    projectId: targetType.value === "project" ? targetId.value || null : null,
    templateId: targetType.value === "template" ? targetId.value || null : null,
    labels: targetType.value === "project" ? labels : [],
  };
  const res = await phrasesStore.add(input);
  if (res.error) {
    setFeedback(res.error, true);
  } else {
    newPhrase.value = "";
    labelsText.value = "";
    setFeedback("Phrase added.");
  }
  saving.value = false;
}

async function removePhrase(phrase) {
  saving.value = true;
  setFeedback("");
  const res = await phrasesStore.remove(phrase.id);
  if (res.error) {
    setFeedback(res.error, true);
  }
  saving.value = false;
}

onMounted(load);
</script>

<style scoped>
.phrases-editor {
  display: grid;
  gap: var(--space-sm);
}

.phrases-count {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.8;
}

.phrases-add {
  display: grid;
  gap: var(--space-2xs);
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  align-items: end;
}

.phrases-add label {
  display: grid;
  gap: 2px;
  font-size: var(--text-sm);
}

.phrases-add button {
  justify-self: start;
}

.phrases-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2xs);
}

.phrase-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.phrase-info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.phrase-text {
  font-weight: 600;
}

.phrase-target,
.phrase-labels {
  opacity: 0.75;
}

.phrase-remove {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--text-lg);
  line-height: 1;
}

.phrases-feedback {
  margin: 0;
  font-size: var(--text-sm);
}

.phrases-feedback.is-error {
  color: #842029;
}
</style>
