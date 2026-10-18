<template>
  <section>
    <header class="section-header">
      <h2>Cleanup</h2>
    </header>

    <p class="section-hint">
      Per-project rules that automatically delete old data once a day.
      Deletions are permanent: only <strong>Done</strong> tasks are eligible
      for task deletion and attachments are removed with their files. No rule
      or a disabled rule means nothing is ever deleted for that project.
      Preview what the rules would delete right now before enabling them.
    </p>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <p v-if="rules.length === 0" class="cleanup-empty">
        <i class="bi bi-inbox" /> No cleanup rule yet — add one below.
      </p>

      <div class="rule-list">
        <article
          v-for="(rule, idx) in rules"
          :key="rule.projectId"
          class="rule-card"
        >
          <div class="rule-header">
            <span class="rule-project" :title="rule.projectId">
              <i class="bi bi-folder2" />
              {{ projectName(rule.projectId) }}
            </span>
            <label class="rule-enabled">
              <input v-model="rule.enabled" type="checkbox" />
              Enabled
            </label>
            <button
              type="button"
              class="small contrast remove-rule-btn"
              title="Remove rule"
              @click="removeRule(idx)"
            >
              <i class="bi bi-trash" />
            </button>
          </div>
          <div class="rule-fields">
            <label>
              Delete Done tasks older than (days)
              <input
                v-model.number="rule.deleteDoneTasksOlderThanDays"
                type="number"
                min="1"
                placeholder="Off"
              />
            </label>
            <label>
              Delete attachments older than (days)
              <input
                v-model.number="rule.deleteAttachmentsOlderThanDays"
                type="number"
                min="1"
                placeholder="Off"
              />
            </label>
            <label>
              Delete voice messages older than (days)
              <input
                v-model.number="rule.deleteVoiceMessagesOlderThanDays"
                type="number"
                min="1"
                placeholder="Off"
              />
            </label>
          </div>
        </article>
      </div>

      <div class="add-rule-row">
        <select v-model="newRuleProjectId">
          <option value="" disabled>Select a project…</option>
          <option
            v-for="project in availableProjects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.name }}{{ project.archived ? " (archived)" : "" }}
          </option>
        </select>
        <button
          type="button"
          class="small"
          :disabled="!newRuleProjectId"
          @click="addRule"
        >
          <i class="bi bi-plus-lg" /> Add rule
        </button>
      </div>

      <div v-if="error" class="cleanup-error">
        <i class="bi bi-exclamation-circle" /> {{ error }}
      </div>
      <div v-if="saveSuccess" class="cleanup-success">
        <i class="bi bi-check-circle" /> Cleanup rules saved
      </div>

      <div class="cleanup-actions">
        <button type="button" :aria-busy="previewing" @click="runPreview">
          <i class="bi bi-eye" /> Preview
        </button>
        <button type="button" :aria-busy="saving" @click="openConfirm">
          <i class="bi bi-check-lg" /> Save rules
        </button>
      </div>

      <div v-if="preview !== null" class="preview-panel">
        <h3>Dry-run preview — what the rules would delete right now</h3>
        <template v-if="previewHasDeletions">
          <div
            v-for="projectPreview in preview"
            :key="projectPreview.projectId"
            class="preview-project"
          >
            <h4>
              <i class="bi bi-folder2" />
              {{ projectName(projectPreview.projectId) }}
            </h4>
            <p class="preview-counts">
              Done tasks: {{ projectPreview.taskCount }} · attachments:
              {{ projectPreview.attachmentCount }} · voice messages:
              {{ projectPreview.voiceMessageCount }}
            </p>
            <ul v-if="projectPreview.taskSamples.length">
              <li
                v-for="sample in projectPreview.taskSamples"
                :key="sample.id"
              >
                <i class="bi bi-check2-circle" /> {{ sample.title }} — Done
                {{ sample.ageDays }} days ago
              </li>
            </ul>
            <ul v-if="projectPreview.attachmentSamples.length">
              <li
                v-for="sample in projectPreview.attachmentSamples"
                :key="sample.id"
              >
                <i class="bi bi-paperclip" /> {{ sample.fileName }}
                <span v-if="sample.isVoiceMessage" class="voice-badge"
                  >voice message</span
                >
                — {{ sample.ageDays }} days old
              </li>
            </ul>
          </div>
        </template>
        <p v-else class="preview-empty">
          <i class="bi bi-emoji-smile" /> Nothing would be deleted right now.
        </p>
      </div>
    </template>

    <!-- Save confirmation -->
    <dialog ref="confirmDialogEl" @close="showConfirm = false">
      <article>
        <header>
          <h3>Save cleanup rules</h3>
        </header>
        <p>
          Deletions are permanent and enforced automatically once a day. Only
          <strong>Done</strong> tasks are eligible for task deletion.
        </p>
        <ul class="confirm-lines">
          <li v-for="line in confirmationLines" :key="line">{{ line }}</li>
        </ul>
        <footer class="dialog-footer">
          <button class="secondary" type="button" @click="showConfirm = false">
            Cancel
          </button>
          <button type="button" :aria-busy="saving" @click="saveRules">
            Save rules
          </button>
        </footer>
      </article>
    </dialog>
  </section>
</template>

<script setup>
import api from "../utils/api";
import {
  buildConfirmationLines,
  buildRulesPayload,
  emptyRuleForm,
  hydrateRuleForms,
} from "../utils/cleanupRules";

const loading = ref(true);
const rules = ref([]);
const projects = ref([]);
const newRuleProjectId = ref("");
const saving = ref(false);
const previewing = ref(false);
const error = ref("");
const saveSuccess = ref(false);
const preview = ref(null);

const showConfirm = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const confirmDialogEl = useModalDialog(() => showConfirm.value);

const availableProjects = computed(() =>
  projects.value.filter(
    (project) => !rules.value.some((rule) => rule.projectId === project.id),
  ),
);

const confirmationLines = computed(() =>
  buildConfirmationLines(rules.value, projectName),
);

const previewHasDeletions = computed(() =>
  preview.value.some(
    (projectPreview) =>
      projectPreview.taskCount > 0 ||
      projectPreview.attachmentCount > 0 ||
      projectPreview.voiceMessageCount > 0,
  ),
);

function projectName(projectId) {
  const project = projects.value.find((p) => p.id === projectId);
  return project ? project.name : projectId;
}

function addRule() {
  if (!newRuleProjectId.value) return;
  error.value = "";
  saveSuccess.value = false;
  rules.value.push(emptyRuleForm(newRuleProjectId.value));
  newRuleProjectId.value = "";
}

function removeRule(idx) {
  error.value = "";
  saveSuccess.value = false;
  rules.value.splice(idx, 1);
}

function openConfirm() {
  error.value = "";
  saveSuccess.value = false;
  showConfirm.value = true;
}

async function runPreview() {
  error.value = "";
  previewing.value = true;
  try {
    const res = await api.post(
      "/cleanup/preview",
      buildRulesPayload(rules.value),
    );
    preview.value = res.data.projects || [];
  } catch (e) {
    error.value = e.response?.data?.error || "Failed to run the preview";
  } finally {
    previewing.value = false;
  }
}

async function saveRules() {
  saving.value = true;
  try {
    const res = await api.put(
      "/cleanup/rules",
      buildRulesPayload(rules.value),
    );
    rules.value = hydrateRuleForms(res.data.rules);
    saveSuccess.value = true;
    showConfirm.value = false;
  } catch (e) {
    error.value = e.response?.data?.error || "Failed to save cleanup rules";
    showConfirm.value = false;
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const [rulesRes, projectsRes] = await Promise.all([
      api.get("/cleanup/rules"),
      api.get("/projects"),
    ]);
    rules.value = hydrateRuleForms(rulesRes.data.rules);
    projects.value = projectsRes.data || [];
  } catch (e) {
    error.value =
      e.response?.status === 403
        ? "Cleanup rules are restricted to admins."
        : "Failed to load cleanup rules";
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.section-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.cleanup-empty {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.rule-list {
  display: grid;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

.rule-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: var(--space-sm);
}

.rule-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-2xs);
}

.rule-project {
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
}

.rule-enabled {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-left: auto;
  font-size: var(--text-md);
}

.rule-enabled input {
  margin: 0;
}

.remove-rule-btn {
  flex-shrink: 0;
}

.rule-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-sm);
}

.rule-fields input {
  margin-top: var(--space-2xs);
}

.add-rule-row {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  margin-bottom: var(--space-sm);
}

.add-rule-row select {
  max-width: 320px;
  margin: 0;
}

.cleanup-error {
  font-size: var(--text-base);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.cleanup-success {
  font-size: var(--text-base);
  color: var(--color-success, var(--color-primary));
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.cleanup-actions {
  display: flex;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.preview-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: var(--space-sm);
}

.preview-panel h3 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
  color: var(--color-text-muted);
}

.preview-project {
  margin-bottom: var(--space-sm);
}

.preview-project h4 {
  font-size: var(--text-md);
  margin-bottom: var(--space-2xs);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.preview-counts {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-2xs);
}

.preview-project ul {
  margin: 0 0 var(--space-2xs) 0;
  padding-left: var(--space-lg);
  font-size: var(--text-sm);
}

.voice-badge {
  display: inline-block;
  padding: 0 0.4em;
  border-radius: var(--radius-sm);
  background: var(--color-primary-light, var(--color-bg-secondary));
  border: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.preview-empty {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
  margin-bottom: 0;
}

.confirm-lines {
  padding-left: var(--space-lg);
  font-size: var(--text-md);
}

button.small {
  padding: 0.2em 0.5em;
  font-size: var(--text-base);
}
</style>
