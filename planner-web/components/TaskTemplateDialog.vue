<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="task-template-dialog">
      <header class="dialog-header">
        <h3>{{ isCreate ? "New Task Template" : "Task Template Details" }}</h3>
        <div class="dialog-actions">
          <button
            v-if="!isCreate && !editing && canEditSelected"
            type="button"
            class="secondary icon-btn"
            aria-label="Edit"
            @click="startEdit"
          >
            <i class="bi bi-pencil" />
          </button>
          <template v-if="isCreate || editing">
            <button
              type="button"
              class="icon-btn"
              :disabled="!canEditSelected"
              :aria-busy="saving"
              :aria-label="isCreate ? 'Create template' : 'Save changes'"
              @click="save"
            >
              <i class="bi bi-check" />
            </button>
            <button
              type="button"
              class="secondary icon-btn"
              aria-label="Cancel"
              @click="handleCancel"
            >
              <i class="bi bi-arrow-counterclockwise" />
            </button>
          </template>
          <details
            v-if="!isCreate && template && canEditSelected"
            ref="advancedMenuEl"
            class="advanced-menu"
          >
            <summary class="secondary" role="button" aria-label="Advanced">
              <i class="bi bi-three-dots" />
            </summary>
            <ul>
              <li>
                <a
                  href="#"
                  :aria-busy="creatingInstance"
                  @click.prevent="createInstance"
                >
                  <i class="bi bi-plus-square" /> Create task instance
                </a>
              </li>
              <li v-if="canDeleteSelected">
                <a
                  href="#"
                  class="danger-item"
                  @click.prevent="openDeleteConfirm"
                >
                  <i class="bi bi-trash" /> Delete template
                </a>
              </li>
            </ul>
          </details>
          <button class="close-btn" aria-label="Close" @click="handleClose">
            ×
          </button>
        </div>
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

      <p v-if="instanceMessage" class="instance-message" role="status">
        <i class="bi bi-check-circle" /> {{ instanceMessage }}
      </p>

      <section v-if="loading" class="loading-indicator" />

      <form v-else-if="isCreate || editing" @submit.prevent="save">
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
            the "Create task instance" action.
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
      </form>

      <template v-else-if="template">
        <!-- Title & description -->
        <section class="edit-section">
          <h2 class="view-title">{{ template.title }}</h2>
          <div
            id="template-description-body"
            class="markdown-collapse"
            :class="{
              'is-truncated': !descriptionExpanded,
              'is-overflowing': descriptionOverflowing,
            }"
          >
            <div
              :ref="setDescriptionContentEl"
              class="markdown-collapse-content markdown-body"
              v-html="renderMarkdown(template.description) || 'No description'"
            />
          </div>
          <button
            v-if="descriptionOverflowing"
            class="expand-btn"
            :aria-expanded="descriptionExpanded"
            aria-controls="template-description-body"
            @click="toggleDescription"
          >
            {{ descriptionExpanded ? "Show less" : "Show more" }}
          </button>
        </section>

        <!-- Meta Info -->
        <section class="meta-section">
          <div class="meta-field">
            <strong>Project</strong>
            <span>{{ projectName || template.projectId }}</span>
          </div>
          <div class="meta-field">
            <strong>Priority</strong>
            <span :class="'priority-' + template.priority">
              <i class="bi bi-flag" /> {{ template.priority }}
            </span>
          </div>
          <div class="meta-field">
            <strong>Assignees</strong>
            <div
              v-if="template.assignees && template.assignees.length"
              class="tag-list"
            >
              <span
                v-for="a in template.assignees"
                :key="a.userId"
                class="tag"
                >{{ a.userName || a.userId }}</span
              >
            </div>
            <span v-else class="text-muted">Unassigned</span>
          </div>
          <div
            v-if="template.labels && template.labels.length"
            class="meta-field"
          >
            <strong>Labels</strong>
            <div class="tag-list">
              <span v-for="l in template.labels" :key="l" class="tag">{{
                l
              }}</span>
            </div>
          </div>
        </section>

        <!-- Automation -->
        <section class="meta-section automation-meta">
          <div class="meta-field">
            <strong>Schedule</strong>
            <span :title="template.automation?.scheduleCron || ''">{{
              automationLabel
            }}</span>
          </div>
          <div class="meta-field">
            <strong>Initial status</strong>
            <span>{{ template.automation?.instanceStatus || "Project default" }}</span>
          </div>
          <div class="meta-field">
            <strong>Skips when the previous instance is open</strong>
            <span>{{
              template.automation?.skipIfPreviousNotDone ? "Yes" : "No"
            }}</span>
          </div>
          <div class="meta-field">
            <strong>Adds the date to the title</strong>
            <span
              :title="
                template.automation?.addDateToTitle ? datedTitleExample : null
              "
              >{{ template.automation?.addDateToTitle ? "Yes" : "No" }}</span
            >
          </div>
        </section>

        <!-- Checklist (read-only initial states; editing happens in Edit mode) -->
        <details
          class="compact-section"
          :open="isSectionOpen('checklist', hasChecklist)"
          @toggle="onSectionToggle('checklist', $event, hasChecklist)"
        >
          <summary>
            Checklist
            <span v-if="hasChecklist" class="count-badge">
              {{ checklistDoneCount }}/{{ template.checklist.length }}
            </span>
          </summary>
          <div v-if="hasChecklist" class="checklist">
            <div
              v-for="(item, idx) in template.checklist"
              :key="idx"
              class="checklist-item"
            >
              <label>
                <input type="checkbox" :checked="item.done" disabled />
                <span :class="{ done: item.done }">{{ item.text }}</span>
              </label>
            </div>
          </div>
          <p v-else class="text-muted">No checklist items.</p>
        </details>

        <!-- Attachments -->
        <details
          class="compact-section"
          :open="isSectionOpen('attachments', hasAttachments)"
          @toggle="onSectionToggle('attachments', $event, hasAttachments)"
        >
          <summary>
            Attachments
            <span v-if="hasAttachments" class="count-badge">
              {{ template.attachments.length }}
            </span>
          </summary>
          <div v-if="hasAttachments" class="attachments">
            <div
              v-for="att in template.attachments"
              :key="att.id"
              class="attachment-item"
            >
              <div class="attachment-info">
                <template
                  v-if="isImageFile(att.fileName) && attachmentUrls[att.id]"
                >
                  <img
                    :src="attachmentUrls[att.id]"
                    :alt="att.fileName"
                    class="attachment-preview"
                    @click="
                      fullscreenAttachment = {
                        fileName: att.fileName,
                        url: attachmentUrls[att.id],
                      }
                    "
                  />
                </template>
                <audio
                  v-else-if="isAudioFile(att.fileName) && attachmentUrls[att.id]"
                  controls
                  preload="none"
                  :src="attachmentUrls[att.id]"
                  class="attachment-audio"
                />
                <a
                  v-if="isPdfFile(att.fileName) && attachmentUrls[att.id]"
                  href="#"
                  class="attachment-link"
                  @click.prevent="
                    fullscreenAttachment = {
                      fileName: att.fileName,
                      url: attachmentUrls[att.id],
                    }
                  "
                >
                  <i class="bi bi-file-earmark-pdf" /> {{ att.fileName }}
                </a>
                <a
                  v-else
                  href="#"
                  rel="noopener"
                  class="attachment-link"
                  @click.prevent="downloadAttachment(att)"
                >
                  <i class="bi bi-paperclip" /> {{ att.fileName }}
                </a>
              </div>
              <button
                class="secondary small-btn"
                :aria-busy="deletingAttachmentId === att.id"
                @click="removeAttachment(att.id)"
              >
                <i class="bi bi-x" />
              </button>
            </div>
          </div>
          <p v-else class="text-muted">No attachments yet.</p>
          <form class="add-attachment" @submit.prevent="uploadAttachment">
            <input ref="fileInput" type="file" class="file-input" />
            <button type="submit" :aria-busy="uploading">Upload</button>
          </form>
        </details>

        <!-- Comments -->
        <details
          class="compact-section"
          :open="isSectionOpen('comments', hasComments)"
          @toggle="onSectionToggle('comments', $event, hasComments)"
        >
          <summary>
            Comments
            <span v-if="hasComments" class="count-badge">
              {{ template.comments.length }}
            </span>
          </summary>
          <div class="comments">
            <div
              v-for="comment in template.comments"
              :key="comment.id"
              class="comment"
            >
              <header>
                <div class="comment-meta">
                  <strong>{{ comment.userName || comment.userId }}</strong>
                  <small :title="formatDate(comment.dateCreated)">{{
                    formatRelativeTime(comment.dateCreated)
                  }}</small>
                  <small
                    v-if="
                      comment.dateUpdated &&
                      comment.dateUpdated !== comment.dateCreated
                    "
                    class="comment-edited"
                    >(edited)</small
                  >
                </div>
                <div v-if="canManageComment(comment)" class="comment-actions">
                  <button
                    class="comment-action-btn"
                    aria-label="Edit comment"
                    @click="startEditComment(comment)"
                  >
                    <i class="bi bi-pencil" />
                  </button>
                  <button
                    class="comment-action-btn danger"
                    aria-label="Delete comment"
                    :aria-busy="deletingCommentId === comment.id"
                    @click="handleDeleteComment(comment.id)"
                  >
                    <i class="bi bi-trash" />
                  </button>
                </div>
              </header>
              <template v-if="editingCommentId === comment.id">
                <div class="comment-edit-form">
                  <CommentComposer
                    v-model="editingCommentText"
                    :draft-key="editCommentDraftKey(comment.id)"
                    :busy="savingComment"
                    placeholder="Edit comment... (Markdown supported)"
                    @submit="saveEditComment(comment.id)"
                  />
                  <div class="comment-edit-actions">
                    <button
                      class="secondary small-btn"
                      @click="cancelEditComment"
                    >
                      Cancel
                    </button>
                    <button
                      class="small-btn"
                      :aria-busy="savingComment"
                      @click="saveEditComment(comment.id)"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </template>
              <div
                v-else
                class="comment-body markdown-body"
                v-html="renderMarkdown(comment.text)"
              />
            </div>
          </div>
          <form class="add-comment" @submit.prevent="postComment">
            <CommentComposer
              v-model="newComment"
              :draft-key="addCommentDraftKey"
              :busy="postingComment"
              @submit="postComment"
            />
            <div class="add-comment-actions">
              <button
                v-if="newComment.trim()"
                type="button"
                class="secondary small-btn"
                @click="discardAddComment"
              >
                Discard
              </button>
              <button type="submit" :aria-busy="postingComment">Send</button>
            </div>
          </form>
        </details>
      </template>

      <!-- Fullscreen attachment viewer (image / pdf via the shared component) -->
      <AttachmentFullscreenViewer
        :attachment="fullscreenAttachment"
        @close="fullscreenAttachment = null"
      />

      <!-- Delete Template Confirmation -->
      <dialog
        ref="deleteDialogEl"
        class="inner-dialog"
        @close="showDeleteConfirm = false"
      >
        <article>
          <header><h3>Delete Template</h3></header>
          <p>
            Delete the template "{{ template?.title }}"? Its created tasks
            are not affected.
          </p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button class="contrast" :aria-busy="deleting" @click="confirmDelete">
              Delete
            </button>
          </footer>
        </article>
      </dialog>

      <!-- Delete Comment Confirmation -->
      <dialog
        ref="deleteCommentDialogEl"
        class="inner-dialog"
        @close="showDeleteCommentConfirm = false"
      >
        <article>
          <header><h3>Delete Comment</h3></header>
          <p>Are you sure you want to delete this comment?</p>
          <footer class="dialog-footer">
            <button
              class="secondary"
              @click="showDeleteCommentConfirm = false"
            >
              Cancel
            </button>
            <button
              class="contrast"
              :aria-busy="!!deletingCommentId"
              @click="deleteComment"
            >
              Delete
            </button>
          </footer>
        </article>
      </dialog>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";
import { cronLabel, buildDatedTitle } from "../utils/taskTemplate";
import { renderMarkdown } from "../composables/useMarkdown";
import { formatRelativeTime } from "../utils/relativeTime";
import {
  loadCommentDraft,
  clearCommentDraft,
} from "../composables/useCommentDraft";
import {
  downloadAttachment as downloadAttachmentFile,
  fetchAttachmentObjectUrl,
  getAttachmentViewerKind,
  isAudioFile,
  isImageFile,
  isPdfFile,
} from "../utils/attachments";
import { displayName } from "../utils/projectHierarchy";
import { projectPermissionFor } from "../stores/projects";

const props = defineProps({
  templateId: { type: String, default: null },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "saved", "deleted"]);

const dialogEl = useModalDialog(() => props.open);

const taskTemplatesStore = useTaskTemplatesStore();
const projectsStore = useProjectsStore();
const authStore = useAuthStore();

const users = ref([]);
const loading = ref(false);
const editing = ref(false);
const saving = ref(false);
const loadError = ref("");
const dialogError = ref("");
const labelsText = ref("");
const advancedMenuEl = ref(null);

const form = ref(emptyForm());

// Instance creation from the advanced menu
const creatingInstance = ref(false);
const instanceMessage = ref("");

// Template deletion (advanced menu, custom confirm)
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);

// Comments / attachments (existing templates only)
const template = computed(() => taskTemplatesStore.currentTemplate);
const newComment = ref("");
const postingComment = ref(false);
const editingCommentId = ref("");
const editingCommentText = ref("");
const savingComment = ref(false);
const showDeleteCommentConfirm = ref(false);
const deleteCommentDialogEl = useModalDialog(
  () => showDeleteCommentConfirm.value,
);
const pendingDeleteCommentId = ref("");
const deletingCommentId = ref("");
const fileInput = ref(null);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fullscreenAttachment = ref(null);
// att.id -> blob object URL for inline previews (image / pdf / audio).
// Attachments are fetched with the Bearer header; the JWT never appears in
// an attachment URL.
const attachmentUrls = ref({});

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
// Deleting a template requires the All permission on its project
const canDeleteSelected = computed(() => selectedPermission.value === "all");

const schedulePreview = computed(() => cronLabel(form.value.scheduleCron));

const datedTitlePreview = computed(() =>
  buildDatedTitle(form.value.title || "Task", new Date()),
);

const automationLabel = computed(
  () => cronLabel(template.value?.automation?.scheduleCron) || "Manual",
);

const datedTitleExample = computed(() =>
  buildDatedTitle(template.value?.title || "Task", new Date()),
);

const projectName = computed(() => {
  const project = projectsStore.projects.find(
    (p) => p.id === template.value?.projectId,
  );
  return project ? displayName(project.name) : "";
});

const hasChecklist = computed(() => !!template.value?.checklist?.length);
const hasAttachments = computed(() => !!template.value?.attachments?.length);
const hasComments = computed(() => !!template.value?.comments?.length);
const checklistDoneCount = computed(() =>
  (template.value?.checklist || []).filter((i) => i.done).length,
);

// Long descriptions collapse behind a "Show more/less" disclosure in view
// mode; Edit mode always shows the full text (the textarea is untouched).
const {
  expanded: descriptionExpanded,
  overflowing: descriptionOverflowing,
  setContentEl: setDescriptionContentEl,
  toggle: toggleDescription,
  reset: resetDescriptionCollapse,
} = useOverflowCollapse();

// Remembered collapse state of the Checklist/Attachments/Comments sections
const { isSectionOpen, onSectionToggle } = useSectionState(
  "planner.sectionState.taskTemplateDialog",
);

// localStorage draft keys: distinct add/edit namespaces under one prefix
const addCommentDraftKey = computed(() =>
  props.templateId ? `planner.commentDraft.taskTemplate.${props.templateId}` : null,
);

function editCommentDraftKey(commentId) {
  return props.templateId
    ? `planner.commentDraft.taskTemplate.${props.templateId}.edit.${commentId}`
    : null;
}

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
    instanceMessage.value = "";
    editing.value = false;
    editingCommentId.value = "";
    editingCommentText.value = "";
    pendingDeleteCommentId.value = "";
    newComment.value = "";
    taskTemplatesStore.currentTemplate = null;
    try {
      const pickerRes = await api.get("/users/picker");
      users.value = pickerRes.data;
    } catch {
      users.value = [];
    }
    if (props.templateId) {
      loading.value = true;
      try {
        const data = await taskTemplatesStore.fetchById(props.templateId);
        seedForm(data);
        newComment.value = loadCommentDraft(addCommentDraftKey.value);
      } catch {
        loadError.value = "Failed to load the template.";
      } finally {
        loading.value = false;
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

// Re-collapse the description when entering or leaving Edit mode; the
// ResizeObserver re-measures overflow once the new content has rendered.
watch(
  () => [props.open, editing.value],
  async () => {
    await nextTick();
    resetDescriptionCollapse();
  },
);

// Fetch image previews, PDF viewers and audio players as blobs whenever the
// attachment list changes (dialog open, upload, delete) and drop object URLs
// for gone attachments
watch(
  () => template.value?.attachments,
  async (attachments) => {
    const validIds = new Set((attachments || []).map((att) => att.id));
    const nextUrls = {};
    for (const [id, url] of Object.entries(attachmentUrls.value)) {
      if (validIds.has(id)) {
        nextUrls[id] = url;
      } else {
        URL.revokeObjectURL(url);
      }
    }
    attachmentUrls.value = nextUrls;
    for (const att of attachments || []) {
      const needsUrl = getAttachmentViewerKind(att.fileName) !== null;
      if (!needsUrl || attachmentUrls.value[att.id]) continue;
      try {
        attachmentUrls.value[att.id] = await fetchAttachmentObjectUrl(
          `/task-templates/${props.templateId}/attachments/${att.id}?inline=true`,
        );
      } catch {
        // No preview available (e.g. removed meanwhile); the file link remains
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  for (const url of Object.values(attachmentUrls.value)) {
    URL.revokeObjectURL(url);
  }
  attachmentUrls.value = {};
});

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
      emit("saved");
      emit("close");
    } else {
      await taskTemplatesStore.update(props.templateId, buildPayload());
      editing.value = false;
      emit("saved");
    }
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to save template";
  } finally {
    saving.value = false;
  }
}

function startEdit() {
  if (!template.value) return;
  seedForm(template.value);
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

function handleCancel() {
  if (isCreate.value) {
    handleClose();
  } else {
    cancelEdit();
  }
}

function closeAdvancedMenu() {
  advancedMenuEl.value?.removeAttribute("open");
}

async function createInstance() {
  closeAdvancedMenu();
  if (!props.templateId || creatingInstance.value) return;
  dialogError.value = "";
  instanceMessage.value = "";
  creatingInstance.value = true;
  try {
    const task = await taskTemplatesStore.createInstance(props.templateId);
    instanceMessage.value = `Created task "${task.title}".`;
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to create the task instance.";
  } finally {
    creatingInstance.value = false;
  }
}

function openDeleteConfirm() {
  closeAdvancedMenu();
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!props.templateId || deleting.value) return;
  dialogError.value = "";
  deleting.value = true;
  try {
    await taskTemplatesStore.remove(props.templateId);
    showDeleteConfirm.value = false;
    emit("deleted");
    emit("close");
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to delete the template.";
  } finally {
    deleting.value = false;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function canManageComment(comment) {
  return authStore.isAdmin || comment.userId === authStore.currentUser?.id;
}

async function postComment() {
  const text = newComment.value.trim();
  if (!text || !props.templateId) return;
  dialogError.value = "";
  postingComment.value = true;
  try {
    await taskTemplatesStore.addComment(props.templateId, text);
    clearCommentDraft(addCommentDraftKey.value);
    newComment.value = "";
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to add comment";
  } finally {
    postingComment.value = false;
  }
}

function discardAddComment() {
  clearCommentDraft(addCommentDraftKey.value);
  newComment.value = "";
}

function startEditComment(comment) {
  // A stored draft (if any) wins over the comment's current text
  editingCommentText.value =
    loadCommentDraft(editCommentDraftKey(comment.id)) || comment.text;
  editingCommentId.value = comment.id;
}

function cancelEditComment() {
  clearCommentDraft(editCommentDraftKey(editingCommentId.value));
  editingCommentId.value = "";
  editingCommentText.value = "";
}

async function saveEditComment(commentId) {
  if (!editingCommentText.value.trim()) return;
  dialogError.value = "";
  savingComment.value = true;
  try {
    await taskTemplatesStore.updateComment(
      props.templateId,
      commentId,
      editingCommentText.value,
    );
    clearCommentDraft(editCommentDraftKey(commentId));
    editingCommentId.value = "";
    editingCommentText.value = "";
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to update comment";
  } finally {
    savingComment.value = false;
  }
}

function handleDeleteComment(commentId) {
  dialogError.value = "";
  pendingDeleteCommentId.value = commentId;
  showDeleteCommentConfirm.value = true;
}

async function deleteComment() {
  const commentId = pendingDeleteCommentId.value;
  if (!commentId || deletingCommentId.value) return;
  deletingCommentId.value = commentId;
  try {
    await taskTemplatesStore.deleteComment(props.templateId, commentId);
    showDeleteCommentConfirm.value = false;
    pendingDeleteCommentId.value = "";
  } catch (e) {
    dialogError.value = e.response?.data?.error || "Failed to delete comment";
  } finally {
    deletingCommentId.value = "";
  }
}

async function uploadAttachment() {
  const input = fileInput.value;
  if (!input || !input.files || !input.files[0]) return;
  dialogError.value = "";
  uploading.value = true;
  try {
    await taskTemplatesStore.uploadAttachment(props.templateId, input.files[0]);
    input.value = "";
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to upload the attachment";
  } finally {
    uploading.value = false;
  }
}

async function removeAttachment(attachmentId) {
  dialogError.value = "";
  deletingAttachmentId.value = attachmentId;
  try {
    await taskTemplatesStore.deleteAttachment(props.templateId, attachmentId);
  } catch (e) {
    dialogError.value =
      e.response?.data?.error || "Failed to delete the attachment";
  } finally {
    deletingAttachmentId.value = "";
  }
}

async function downloadAttachment(att) {
  dialogError.value = "";
  try {
    await downloadAttachmentFile(
      `/task-templates/${props.templateId}/attachments/${att.id}`,
      att.fileName,
    );
  } catch {
    dialogError.value = "Failed to download attachment";
  }
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

/* Inline dismissible error banner (replaces browser alert()) */
.dialog-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-bottom: var(--space-md);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  color: var(--color-danger);
  background: var(--color-surface);
}

.dialog-error-dismiss {
  background: none;
  border: none;
  color: var(--color-danger);
  font-size: var(--text-lg);
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-2xs);
}

.dialog-error-dismiss:hover {
  color: var(--color-danger-hover);
}

.instance-message {
  margin: 0 0 var(--space-md);
  font-size: var(--text-base);
  color: var(--color-success, var(--color-primary));
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.permission-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-top: 0;
}

.edit-section {
  margin-bottom: var(--space-sm);
}

.view-title {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-xl);
}

.meta-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  font-size: var(--text-base);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  /* Dropdowns rendered inside must overflow this section: without this,
     the global `dialog article section` scroll rule (base.css) clips them */
  overflow: visible;
  max-height: none;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  min-width: 0;
}

.meta-field span {
  overflow-wrap: break-word;
}

.meta-section .tag {
  /* Cancel the section's smaller font-size so tag pills keep their
     original em-based size (main.css sets .tag { font-size: var(--text-base) }) */
  font-size: 1em;
}

.tag-list {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.text-muted {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.priority-high {
  color: var(--color-danger);
}
.priority-medium {
  color: var(--color-primary);
}
.priority-low {
  color: var(--color-text-muted);
}

section {
  margin-bottom: var(--space-md);
}

section h4 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
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

.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
}

.checklist-item label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex: 1;
  min-width: 0;
  margin: 0;
}

.checklist-item .done {
  text-decoration: line-through;
  color: var(--color-text-muted);
}

.attachments {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.attachment-link {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.attachment-link:hover {
  text-decoration: underline;
}

.attachment-info {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.attachment-preview {
  max-width: 60px;
  max-height: 60px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/* Inline audio player for audio attachments (voice messages) */
.attachment-audio {
  height: 2rem;
  max-width: min(100%, 280px);
}

.small-btn {
  padding: 0.1em 0.4em;
  font-size: var(--text-base);
}

.add-attachment {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
}

/* The comment form stacks: composer (tabs + textarea) with the action row
   below it, GitHub-style */
.add-comment {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-xs);
}

.add-comment-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-xs);
}

.comments {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

/* Comment items are plain divs on purpose: bare <article> is the design
   language's Card component and its "article > header" bleeds outside the
   card with negative margins, overlapping the section summary (base.css). */
.comment {
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.comment header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.comment header strong {
  font-size: var(--text-md);
}

.comment-meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-2xs);
  min-width: 0;
}

.comment-edited {
  color: var(--color-text-muted);
  font-style: italic;
}

.comment-actions {
  display: flex;
  gap: var(--space-2xs);
  margin-left: auto;
}

.comment-action-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  padding: 0 var(--space-2xs);
  cursor: pointer;
  line-height: 1;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.comment:hover .comment-action-btn,
.comment:focus-within .comment-action-btn {
  opacity: 1;
}

/* Touch devices have no hover: keep the comment actions always visible */
@media (hover: none) {
  .comment-action-btn {
    opacity: 1;
  }
}

.comment-action-btn:hover {
  color: var(--color-primary-text);
}

.comment-action-btn.danger:hover {
  color: var(--color-danger);
}

.comment-edit-form {
  margin-top: var(--space-xs);
}

.comment-edit-actions {
  display: flex;
  gap: var(--space-xs);
  justify-content: flex-end;
}

/* Flatten heading sizes inside comment markdown so titles don't dominate */
.comment-body.markdown-body h1,
.comment-body.markdown-body h2,
.comment-body.markdown-body h3,
.comment-body.markdown-body h4,
.comment-body.markdown-body h5,
.comment-body.markdown-body h6 {
  margin-top: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.comment-body.markdown-body h1 {
  font-size: 1.15em;
}
.comment-body.markdown-body h2 {
  font-size: 1.08em;
}
.comment-body.markdown-body h3 {
  font-size: 1.02em;
}
.comment-body.markdown-body h4 {
  font-size: 1em;
}

.comment-body {
  /* flow-root keeps child margins from collapsing out of the container */
  display: flow-root;
  font-size: var(--text-md);
  line-height: 1.5;
  overflow-wrap: break-word;
  min-width: 0;
}

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}

/* Collapsible compact sections */
.compact-section {
  margin-bottom: var(--space-sm);
  border: 1px solid
    var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.compact-section summary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  font-weight: var(--weight-semibold);
  font-size: var(--text-base);
  background: var(--color-surface);
  user-select: none;
  list-style: none;
}

.compact-section summary::-webkit-details-marker {
  display: none;
}

.compact-section summary::before {
  content: "▸";
  font-size: var(--text-sm);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.compact-section[open] summary::before {
  transform: rotate(90deg);
}

.compact-section[open] summary {
  border-bottom: 1px solid
    var(--color-border);
}

.compact-section > *:not(summary) {
  padding: 0 var(--space-sm);
}

.compact-section .checklist,
.compact-section .attachments,
.compact-section .comments {
  padding-top: var(--space-xs);
}

.compact-section .add-attachment,
.compact-section .add-comment {
  padding: var(--space-xs) 0 var(--space-sm);
}

.count-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
  padding: 0.05em 0.35em;
  border-radius: var(--radius-full);
  margin-left: auto;
}
</style>
