<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="task-template-dialog">
      <header class="dialog-header">
        <h3>{{ isCreate ? "New Task Template" : "Edit Task Template" }}</h3>
        <button class="close-btn" aria-label="Close" @click="handleClose">
          ×
        </button>
      </header>

      <div v-if="loadError" class="dialog-error" role="alert">
        <span>{{ loadError }}</span>
      </div>

      <div v-if="dialogError" class="dialog-error" role="alert">
        <span>{{ dialogError }}</span>
        <button
          class="dialog-error-dismiss"
          aria-label="Dismiss error"
          @click="dialogError = ''"
        >
          ×
        </button>
      </div>

      <form @submit.prevent="save">
        <label>
          Project
          <ProjectSelect v-model="form.projectId" />
        </label>
        <p v-if="selectedProject && !canEditSelected" class="permission-hint">
          <i class="bi bi-lock" />
          You have the "{{ selectedPermission }}" permission on this project —
          you can view this template but not save it.
        </p>
        <label>
          Title
          <input
            v-model="form.title"
            type="text"
            required
            placeholder="Template title">
        </label>
        <label>
          Description
          <textarea
            v-model="form.description"
            placeholder="Optional description"
          />
        </label>
        <label>
          Priority
          <select v-model="form.priority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <fieldset>
          <legend>Assignees</legend>
          <UserMultiSelect v-model="form.assignees" :users="users" />
        </fieldset>
        <fieldset>
          <legend>Labels</legend>
          <input
            v-model="labelsText"
            type="text"
            placeholder="Comma-separated labels, e.g. ops, weekly">
        </fieldset>
        <fieldset>
          <legend>Checklist</legend>
          <div
            v-for="(item, idx) in form.checklist"
            :key="idx"
            class="checklist-input-row"
          >
            <input
              v-model="form.checklist[idx].text"
              type="text"
              placeholder="Checklist item">
            <button
              type="button"
              class="small secondary"
              @click="form.checklist.splice(idx, 1)"
            >
              <i class="bi bi-x" />
            </button>
          </div>
          <button
            type="button"
            class="small"
            @click="form.checklist.push({ text: '', done: false })"
          >
            <i class="bi bi-plus" /> Add item
          </button>
        </fieldset>

        <fieldset class="automation-section">
          <legend>Automation</legend>
          <label class="automation-row">
            <span class="automation-label">Schedule</span>
            <input
              v-model="form.scheduleCron"
              type="text"
              placeholder="Cron expression, e.g. 0 9 * * 1"
              spellcheck="false">
          </label>
          <p v-if="schedulePreview" class="automation-hint">
            <i class="bi bi-clock" /> {{ schedulePreview }}
          </p>
          <p v-else class="automation-hint">
            <i class="bi bi-info-circle" />
            Empty schedule = manual template: instances are created only from
            the "Create task" action.
          </p>
          <label class="automation-check">
            <input
              v-model="form.skipIfPreviousNotDone"
              type="checkbox">
            Skip when the previous instance is not Done
          </label>
          <label class="automation-check">
            <input v-model="form.addDateToTitle" type="checkbox">
            Add the day date to the instance title
          </label>
          <p v-if="form.addDateToTitle" class="automation-hint">
            <i class="bi bi-tag" /> Instances will be titled
            "<strong>{{ datedTitlePreview }}</strong
            >".
          </p>
          <label class="automation-row">
            <span class="automation-label">Initial status</span>
            <select v-model="form.instanceStatus">
              <option value="">Project default</option>
              <option
                v-for="status in selectedProject?.statuses || []"
                :key="status"
                :value="status"
              >
                {{ status }}
              </option>
            </select>
          </label>
          <p class="automation-hint">
            <i class="bi bi-flag" />
            Status every created instance starts in; "Project default" uses
            the project's first status.
          </p>
        </fieldset>

        <template v-if="!isCreate">
          <fieldset>
            <legend>Attachments</legend>
            <ul v-if="template?.attachments?.length" class="attachment-list">
              <li
                v-for="attachment in template.attachments"
                :key="attachment.id"
              >
                <i class="bi bi-file-earmark" />
                <span class="attachment-name">{{ attachment.fileName }}</span>
                <button
                  type="button"
                  class="small secondary"
                  :aria-label="`Download ${attachment.fileName}`"
                  @click="downloadAttachmentFile(attachment)"
                >
                  <i class="bi bi-download" />
                </button>
                <button
                  type="button"
                  class="small secondary"
                  :aria-label="`Delete ${attachment.fileName}`"
                  @click="removeAttachment(attachment)"
                >
                  <i class="bi bi-trash" />
                </button>
              </li>
            </ul>
            <p v-else class="automation-hint">No attachments yet.</p>
            <input
              ref="attachmentInputEl"
              type="file"
              aria-label="Upload attachment"
              @change="uploadAttachmentFile">
          </fieldset>

          <fieldset>
            <legend>Comments</legend>
            <ul v-if="template?.comments?.length" class="template-comment-list">
              <li
                v-for="comment in template.comments"
                :key="comment.id"
                class="template-comment"
              >
                <template v-if="editingCommentId === comment.id">
                  <textarea
                    v-model="editingCommentText"
                    rows="2"
                    :aria-label="`Edit comment by ${comment.userName || comment.userId}`"
                  />
                  <div class="comment-actions">
                    <button
                      type="button"
                      class="small"
                      :aria-busy="savingComment"
                      @click="saveCommentEdit(comment)"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      class="small secondary"
                      @click="editingCommentId = ''"
                    >
                      Cancel
                    </button>
                  </div>
                </template>
                <template v-else>
                  <div class="template-comment-head">
                    <strong>{{ comment.userName || comment.userId }}</strong>
                    <small>{{
                      new Date(comment.dateCreated).toLocaleString()
                    }}</small>
                    <span
                      v-if="canManageComment(comment)"
                      class="comment-actions"
                    >
                      <button
                        type="button"
                        class="small secondary"
                        aria-label="Edit comment"
                        @click="startCommentEdit(comment)"
                      >
                        <i class="bi bi-pencil" />
                      </button>
                      <button
                        type="button"
                        class="small secondary"
                        aria-label="Delete comment"
                        @click="removeComment(comment)"
                      >
                        <i class="bi bi-trash" />
                      </button>
                    </span>
                  </div>
                  <!-- Comment text is plain text: interpolated, never v-html'd -->
                  <p class="template-comment-text">{{ comment.text }}</p>
                </template>
              </li>
            </ul>
            <textarea
              v-model="newCommentText"
              rows="2"
              placeholder="Add a comment…"
              :aria-label="'New comment'"
            />
            <button
              type="button"
              class="small"
              :disabled="!newCommentText.trim()"
              :aria-busy="postingComment"
              @click="postComment"
            >
              <i class="bi bi-chat-left-text" /> Comment
            </button>
          </fieldset>
        </template>

        <footer class="dialog-footer">
          <button type="submit" :disabled="!canEditSelected" :aria-busy="saving">
            {{ isCreate ? "Create template" : "Save changes" }}
          </button>
          <button class="secondary" type="button" @click="handleClose">
            Cancel
          </button>
        </footer>
      </form>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";
import { cronLabel, buildDatedTitle } from "../utils/taskTemplate";
import { downloadAttachment } from "../utils/attachments";
import { projectPermissionFor } from "../stores/projects";

const props = defineProps({
  templateId: { type: String, default: null },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "saved"]);

const dialogEl = useModalDialog(() => props.open);

const taskTemplatesStore = useTaskTemplatesStore();
const projectsStore = useProjectsStore();
const authStore = useAuthStore();

const users = ref([]);
const saving = ref(false);
const loadError = ref("");
const dialogError = ref("");
const labelsText = ref("");

const form = ref(emptyForm());

// Comments / attachments (existing templates only)
const template = computed(() => taskTemplatesStore.currentTemplate);
const newCommentText = ref("");
const postingComment = ref(false);
const editingCommentId = ref("");
const editingCommentText = ref("");
const savingComment = ref(false);
const attachmentInputEl = ref(null);

const isCreate = computed(() => !props.templateId);

const selectedProject = computed(() =>
  projectsStore.projects.find((p) => p.id === form.value.projectId),
);
const selectedPermission = computed(() =>
  projectPermissionFor(
    selectedProject.value,
    authStore.currentUser?.id,
    authStore.isAdmin,
  ),
);
const canEditSelected = computed(() =>
  ["update", "all"].includes(selectedPermission.value),
);

const schedulePreview = computed(() => cronLabel(form.value.scheduleCron));

const datedTitlePreview = computed(() =>
  buildDatedTitle(form.value.title || "Task", new Date()),
);

function emptyForm() {
  return {
    projectId: "",
    title: "",
    description: "",
    priority: "medium",
    checklist: [],
    assignees: [],
    scheduleCron: "",
    skipIfPreviousNotDone: false,
    addDateToTitle: false,
    instanceStatus: "",
  };
}

function seedForm(data) {
  form.value = {
    projectId: data.projectId || "",
    title: data.title || "",
    description: data.description || "",
    priority: data.priority || "medium",
    checklist: (data.checklist || []).map((item) => ({ ...item })),
    assignees: (data.assignees || []).map((a) => a.userId),
    scheduleCron: data.automation?.scheduleCron || "",
    skipIfPreviousNotDone: !!data.automation?.skipIfPreviousNotDone,
    addDateToTitle: !!data.automation?.addDateToTitle,
    instanceStatus: data.automation?.instanceStatus || "",
  };
  labelsText.value = (data.labels || []).join(", ");
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    loadError.value = "";
    dialogError.value = "";
    editingCommentId.value = "";
    newCommentText.value = "";
    taskTemplatesStore.currentTemplate = null;
    try {
      const pickerRes = await api.get("/users/picker");
      users.value = pickerRes.data;
    } catch {
      users.value = [];
    }
    if (props.templateId) {
      try {
        const data = await taskTemplatesStore.fetchById(props.templateId);
        seedForm(data);
      } catch {
        loadError.value = "Failed to load the template.";
      }
    } else {
      // Default to the stored project filter, then the first active project
      const stored = projectsStore.selectedProjectFilter;
      const storedProject = projectsStore.activeProjects.find(
        (p) => p.id === stored,
      );
      const fallback = projectsStore.activeProjects[0];
      form.value = emptyForm();
      form.value.projectId = storedProject?.id || fallback?.id || "";
    }
  },
);

function buildPayload() {
  return {
    projectId: form.value.projectId,
    title: form.value.title,
    description: form.value.description,
    priority: form.value.priority,
    checklist: form.value.checklist.filter((c) => c.text.trim()),
    automation: {
      scheduleCron: form.value.scheduleCron.trim() || null,
      skipIfPreviousNotDone: form.value.skipIfPreviousNotDone,
      addDateToTitle: form.value.addDateToTitle,
      instanceStatus: form.value.instanceStatus || null,
    },
    assignees: form.value.assignees,
    labels: labelsText.value
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

async function save() {
  dialogError.value = "";
  if (!form.value.title.trim()) {
    dialogError.value = "Title is required.";
    return;
  }
  if (!form.value.projectId) {
    dialogError.value = "Project is required.";
    return;
  }
  saving.value = true;
  try {
    if (isCreate.value) {
      await taskTemplatesStore.create(buildPayload());
    } else {
      await taskTemplatesStore.update(props.templateId, buildPayload());
    }
    emit("saved");
    emit("close");
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to save template";
  } finally {
    saving.value = false;
  }
}

function canManageComment(comment) {
  return authStore.isAdmin || comment.userId === authStore.currentUser?.id;
}

async function postComment() {
  const text = newCommentText.value.trim();
  if (!text || !props.templateId) return;
  postingComment.value = true;
  try {
    await taskTemplatesStore.addComment(props.templateId, text);
    newCommentText.value = "";
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to add comment";
  } finally {
    postingComment.value = false;
  }
}

function startCommentEdit(comment) {
  editingCommentId.value = comment.id;
  editingCommentText.value = comment.text;
}

async function saveCommentEdit(comment) {
  const text = editingCommentText.value.trim();
  if (!text) return;
  savingComment.value = true;
  try {
    await taskTemplatesStore.updateComment(
      props.templateId,
      comment.id,
      text,
    );
    editingCommentId.value = "";
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to update comment";
  } finally {
    savingComment.value = false;
  }
}

async function removeComment(comment) {
  try {
    await taskTemplatesStore.deleteComment(props.templateId, comment.id);
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to delete comment";
  }
}

async function uploadAttachmentFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !props.templateId) return;
  try {
    await taskTemplatesStore.uploadAttachment(props.templateId, file);
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to upload the attachment";
  }
}

async function removeAttachment(attachment) {
  try {
    await taskTemplatesStore.deleteAttachment(
      props.templateId,
      attachment.id,
    );
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to delete the attachment";
  }
}

async function downloadAttachmentFile(attachment) {
  await downloadAttachment(
    `/task-templates/${props.templateId}/attachments/${attachment.id}`,
    attachment.fileName,
  );
}

function handleClose() {
  emit("close");
}
</script>

<style scoped>
.task-template-dialog {
  max-width: 720px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.permission-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-top: 0;
}

.automation-section legend {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.automation-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-sm);
  align-items: center;
}

.automation-label {
  font-weight: var(--weight-medium);
}

.automation-check {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-weight: var(--weight-normal);
}

.automation-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin: var(--space-2xs) 0;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.checklist-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
  align-items: center;
}

.checklist-input-row button {
  padding: 0.2em 0.5em;
}

.attachment-list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.attachment-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.attachment-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-comment-list {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.template-comment {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2xs) var(--space-xs);
}

.template-comment-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.template-comment-head small {
  color: var(--color-text-muted);
}

.comment-actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2xs);
}

.template-comment-text {
  margin: var(--space-2xs) 0 0;
  white-space: pre-wrap;
}
</style>
