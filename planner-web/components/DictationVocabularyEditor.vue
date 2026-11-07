<template>
  <div class="vocabulary-editor">
    <label>
      Vocabulary scope
      <select v-model="scope" aria-label="Vocabulary scope">
        <option value="">Personal</option>
        <option
          v-for="project in projects"
          :key="project.id"
          :value="project.id"
        >
          {{ project.name }}
        </option>
      </select>
    </label>
    <p class="vocabulary-count" aria-live="polite">
      {{ vocabularyStore.count }} / {{ vocabularyMax }} terms total
    </p>

    <form class="vocabulary-add" @submit.prevent="addTerm">
      <label>
        Add a term
        <input
          v-model="newTerm"
          type="text"
          placeholder="Name or jargon"
          aria-label="New vocabulary term"
        />
      </label>
      <button
        type="submit"
        :disabled="!newTerm.trim() || atLimit || saving"
        :aria-busy="saving"
      >
        Add
      </button>
    </form>

    <ul v-if="scopedTerms.length > 0" class="vocabulary-chips">
      <li v-for="term in scopedTerms" :key="term.id" class="vocabulary-chip">
        <span>{{ term.term }}</span>
        <button
          type="button"
          class="vocabulary-remove"
          :aria-label="`Remove ${term.term}`"
          @click="removeTerm(term)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-else class="setting-hint">No terms in this scope yet.</p>

    <details class="vocabulary-import">
      <summary>Import / export (plain text)</summary>
      <p class="setting-hint">
        One term per line. Import replaces the terms of the selected scope.
      </p>
      <textarea
        v-model="importText"
        rows="5"
        aria-label="Terms to import"
        placeholder="Term A&#10;Term B"
      />
      <div class="vocabulary-actions">
        <button
          type="button"
          :disabled="saving || !importText.trim()"
          :aria-busy="saving"
          @click="importTerms"
        >
          Replace scope
        </button>
        <button type="button" class="secondary" @click="exportTerms">
          <i class="bi bi-download" /> Export scope
        </button>
      </div>
    </details>

    <p
      v-if="feedback"
      class="vocabulary-feedback"
      :class="{ 'is-error': feedbackIsError }"
      role="status"
      aria-live="polite"
    >
      {{ feedback }}
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";

const props = defineProps({
  // Preselect a project scope (the personal scope is the default)
  initialProjectId: { type: String, default: "" },
});

const vocabularyStore = useDictationVocabularyStore();
const projectsStore = useProjectsStore();
const recommendationStore = useRecommendationStore();

const scope = ref(props.initialProjectId || "");
const newTerm = ref("");
const importText = ref("");
const saving = ref(false);
const feedback = ref("");
const feedbackIsError = ref(false);

const vocabularyMax = computed(
  () => recommendationStore.dictationVocabularyMax,
);
const projects = computed(() => projectsStore.activeProjects || []);
const scopedTerms = computed(() => vocabularyStore.termsFor(scope.value || null));
const atLimit = computed(() => vocabularyStore.count >= vocabularyMax.value);

function setFeedback(message, isError = false) {
  feedback.value = message;
  feedbackIsError.value = isError;
}

function syncImportText() {
  importText.value = scopedTerms.value.map((term) => term.term).join("\n");
}

watch(scope, syncImportText);

onMounted(async () => {
  if (vocabularyStore.terms.length === 0) {
    await vocabularyStore.fetchAll();
  }
  syncImportText();
  if (projectsStore.projects.length === 0) {
    try {
      await projectsStore.fetchAll();
    } catch {
      // The scope list falls back to Personal when projects cannot load
    }
  }
});

async function addTerm() {
  const term = newTerm.value.trim();
  if (!term || saving.value) {
    return;
  }
  saving.value = true;
  setFeedback("");
  try {
    const res = await vocabularyStore.add(term, scope.value || null);
    if (res.error) {
      setFeedback(res.error, true);
      return;
    }
    newTerm.value = "";
    syncImportText();
    setFeedback(`Added “${term}”.`);
  } finally {
    saving.value = false;
  }
}

async function removeTerm(term) {
  setFeedback("");
  const res = await vocabularyStore.remove(term.id);
  if (res.error) {
    setFeedback(res.error, true);
    return;
  }
  syncImportText();
  setFeedback(`Removed “${term.term}”.`);
}

async function importTerms() {
  const terms = importText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  saving.value = true;
  setFeedback("");
  try {
    const res = await vocabularyStore.replaceScope(
      scope.value || null,
      terms,
    );
    if (res.error) {
      setFeedback(res.error, true);
      return;
    }
    syncImportText();
    setFeedback(`Saved ${res.terms?.length || 0} term(s).`);
  } finally {
    saving.value = false;
  }
}

function exportTerms() {
  const text = scopedTerms.value.map((term) => term.term).join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dictation-vocabulary.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setFeedback(`Exported ${scopedTerms.value.length} term(s).`);
}
</script>

<style scoped>
.vocabulary-editor {
  display: grid;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.vocabulary-count {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.8;
}

.vocabulary-add {
  display: flex;
  align-items: flex-end;
  gap: var(--space-xs);
}

.vocabulary-add label {
  flex: 1;
}

.vocabulary-chips {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.vocabulary-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.05em 0.4em;
  font-size: var(--text-sm);
}

.vocabulary-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}

.vocabulary-import summary {
  cursor: pointer;
  font-size: var(--text-sm);
}

.vocabulary-import textarea {
  margin: var(--space-2xs) 0;
}

.vocabulary-actions {
  display: flex;
  gap: var(--space-2xs);
}

.vocabulary-feedback {
  margin: 0;
  font-size: var(--text-sm);
}

.vocabulary-feedback.is-error {
  color: var(--color-danger);
}

.setting-hint {
  font-size: var(--text-sm);
  opacity: 0.7;
  margin: 0;
}
</style>
