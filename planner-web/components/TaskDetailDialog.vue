<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="task-detail-dialog">
      <header class="dialog-header">
        <h3>Task Details</h3>
        <div class="dialog-actions">
          <button
            v-if="!editing"
            class="secondary icon-btn"
            aria-label="Edit"
            @click="startEdit"
          >
            <i class="bi bi-pencil" />
          </button>
          <template v-if="editing">
            <button
              class="icon-btn"
              :aria-busy="saving"
              aria-label="Save"
              @click="saveEdit"
            >
              <i class="bi bi-check" />
            </button>
            <button
              class="secondary icon-btn"
              aria-label="Cancel"
              @click="cancelEdit"
            >
              <i class="bi bi-arrow-counterclockwise" />
            </button>
          </template>
          <details v-if="task" ref="advancedMenuEl" class="advanced-menu">
            <summary class="secondary" role="button" aria-label="Advanced">
              <i class="bi bi-three-dots" />
            </summary>
            <ul>
              <li>
                <a
                  href="#"
                  :aria-busy="cloning"
                  @click.prevent="cloneTask"
                >
                  <i class="bi bi-copy" /> Clone Task
                </a>
              </li>
              <li v-if="isImproveEnabled">
                <a
                  href="#"
                  :aria-busy="improving"
                  @click.prevent="improveTask"
                >
                  <i class="bi bi-stars" /> Improve with AI
                </a>
              </li>
              <li v-if="canCancelTask">
                <a
                  href="#"
                  class="danger-item"
                  :aria-busy="cancelling"
                  @click.prevent="openCancelConfirm"
                >
                  <i class="bi bi-x-circle" /> Cancel Task
                </a>
              </li>
              <li>
                <a href="#" class="danger-item" @click.prevent="openDeleteConfirm">
                  <i class="bi bi-trash" /> Delete Task
                </a>
              </li>
            </ul>
          </details>
          <button class="close-btn" aria-label="Close" @click="handleClose">
            ×
          </button>
        </div>
      </header>

      <section v-if="loading" class="loading-indicator" />

      <section v-else-if="notFound" class="task-not-found">
        <p>This task is not available.</p>
      </section>

      <template v-else-if="task">
        <div v-if="dialogError" class="dialog-error" role="alert">
          <span>{{ dialogError }}</span>
          <button
            class="dialog-error-dismiss"
            aria-label="Dismiss error"
            @click="dismissDialogError"
          >
            ×
          </button>
        </div>

        <!-- Status dropdown — always visible -->
        <section class="status-bar">
          <label class="status-select">
            <strong>Status</strong>
            <span
              class="status-dot"
              :style="{ backgroundColor: statusColor }"
              :title="task.status"
            />
            <select
              :value="task.status"
              :aria-busy="savingStatus"
              @change="onStatusChange($event)"
            >
              <option v-for="s in availableStatuses" :key="s" :value="s">
                {{ s }}
              </option>
            </select>
          </label>
        </section>

        <!-- Editable Fields -->
        <section class="edit-section">
          <label>
            Title
            <input
              v-if="editing"
              v-model="editForm.title"
              type="text"
              required
            />
            <h2 v-else>{{ task.title }}</h2>
          </label>
          <label>
            Description
            <textarea v-if="editing" v-model="editForm.description" rows="3" />
            <div
              v-else
              id="task-description-body"
              class="markdown-collapse"
              :class="{
                'is-truncated': !descriptionExpanded,
                'is-overflowing': descriptionOverflowing,
              }"
            >
              <div
                :ref="setDescriptionContentEl"
                class="markdown-collapse-content markdown-body"
                v-html="renderMarkdown(task.description) || 'No description'"
              />
            </div>
          </label>
          <!-- Outside the <label>: a <button> is a labelable element, so
               leaving it inside would forward clicks on the description text
               to the toggle. -->
          <button
            v-if="!editing && descriptionOverflowing"
            class="expand-btn"
            :aria-expanded="descriptionExpanded"
            aria-controls="task-description-body"
            @click="toggleDescription"
          >
            {{ descriptionExpanded ? "Show less" : "Show more" }}
          </button>
        </section>

        <!-- Meta Info -->
        <section class="meta-section">
          <div class="meta-field">
            <strong>Project</strong>
            <ProjectSelect v-if="editing" v-model="editForm.projectId" />
            <span v-else>{{ projectName || task.projectId }}</span>
          </div>
          <div class="meta-field">
            <strong>Priority</strong>
            <select v-if="editing" v-model="editForm.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <span v-else :class="'priority-' + task.priority">
              <i class="bi bi-flag" /> {{ task.priority }}
            </span>
          </div>
          <div class="meta-field">
            <strong>Due date</strong>
            <input v-if="editing" v-model="editForm.dueDate" type="date" />
            <span
              v-else
              :class="dueUrgency ? `due-${dueUrgency}` : null"
              :title="dueUrgencyTitle"
            >
              {{ task.dueDate || "No due date" }}
              <i v-if="dueUrgency" class="bi bi-exclamation-triangle" />
            </span>
          </div>
          <div class="meta-field">
            <strong>Assignees</strong>
            <UserMultiSelect
              v-if="editing"
              v-model="editForm.assignees"
              :users="users"
            />
            <div v-else-if="task.assignees && task.assignees.length" class="tag-list">
              <span v-for="a in task.assignees" :key="a.userId" class="tag">{{
                a.userName || a.userId
              }}</span>
            </div>
            <span v-else class="text-muted">Unassigned</span>
          </div>
          <div v-if="task.labels && task.labels.length" class="meta-field">
            <strong>Labels</strong>
            <div class="tag-list">
              <span v-for="l in task.labels" :key="l" class="tag">{{ l }}</span>
            </div>
          </div>
        </section>

        <!-- Checklist -->
        <details
          class="compact-section"
          :open="isSectionOpen('checklist', hasChecklist)"
          @toggle="onSectionToggle('checklist', $event, hasChecklist)"
        >
          <summary>
            Checklist
            <span v-if="hasChecklist" class="count-badge">
              {{ checklistDoneCount }}/{{ task.checklist.length }}
            </span>
            <span
              v-if="hasChecklist"
              class="checklist-progress"
              role="progressbar"
              :aria-valuenow="checklistDoneCount"
              aria-valuemin="0"
              :aria-valuemax="task.checklist.length"
              aria-label="Checklist progress"
            >
              <span
                class="checklist-progress-fill"
                :style="{ width: checklistPercent + '%' }"
              />
            </span>
          </summary>
          <div v-if="hasChecklist" class="checklist">
            <div
              v-for="(item, idx) in task.checklist"
              :key="idx"
              class="checklist-item"
            >
              <label>
                <input
                  type="checkbox"
                  :checked="item.done"
                  @change="toggleChecklist(idx)"
                />
                <span :class="{ done: item.done }">{{ item.text }}</span>
              </label>
              <button
                class="checklist-item-delete"
                :aria-label="`Delete checklist item: ${item.text}`"
                @click="deleteChecklistItem(idx)"
              >
                <i class="bi bi-x" />
              </button>
            </div>
          </div>
          <div class="add-checklist-item">
            <input
              v-model="newChecklistText"
              type="text"
              placeholder="Add checklist item..."
              @keyup.enter="addChecklistItem"
            />
            <button :aria-busy="savingChecklist" @click="addChecklistItem">
              Add
            </button>
          </div>
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
              {{ task.attachments.length }}
            </span>
          </summary>
          <div v-if="hasAttachments" class="attachments">
            <div
              v-for="att in task.attachments"
              :key="att.id"
              class="attachment-item"
            >
              <div class="attachment-info">
                <template v-if="isImageFile(att.fileName)">
                  <img
                    :src="`/api/tasks/${task.id}/attachments/${att.id}?inline=true&token=${authToken}`"
                    :alt="att.fileName"
                    class="attachment-preview"
                    @click="
                      fullscreenImage = `/api/tasks/${task.id}/attachments/${att.id}?inline=true&token=${authToken}`
                    "
                  />
                </template>
                <a
                  :href="`/api/tasks/${task.id}/attachments/${att.id}?token=${authToken}`"
                  target="_blank"
                  class="attachment-link"
                >
                  <i class="bi bi-paperclip" /> {{ att.fileName }}
                </a>
              </div>
              <button
                class="secondary small-btn"
                :aria-busy="deletingAttachmentId === att.id"
                @click="deleteAttachment(att.id)"
              >
                <i class="bi bi-x" />
              </button>
            </div>
          </div>
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
              {{ task.comments.length }}
            </span>
          </summary>
          <button
            v-if="hiddenCommentsCount > 0"
            class="expand-btn show-earlier-btn"
            :aria-expanded="showAllComments"
            aria-controls="comments-list"
            @click="showAllComments = true"
          >
            Show {{ hiddenCommentsCount }} earlier comments
          </button>
          <div id="comments-list" class="comments">
            <div
              v-for="comment in visibleComments"
              :id="`comment-${comment.id}`"
              :key="comment.id"
              class="comment"
              :class="{ 'comment-highlight': highlightedCommentId === comment.id }"
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
                <div class="comment-actions">
                  <button
                    class="comment-action-btn"
                    aria-label="Copy link to comment"
                    @click="copyCommentLink(comment.id)"
                  >
                    <i class="bi bi-link-45deg" />
                  </button>
                  <template v-if="canModifyComment(comment)">
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
                  </template>
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
                    <button class="secondary small-btn" @click="cancelEditComment">Cancel</button>
                    <button class="small-btn" :aria-busy="savingComment" @click="saveEditComment(comment.id)">Save</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div
                  :id="`comment-body-${comment.id}`"
                  class="comment-body markdown-body"
                  :class="{ 'is-truncated': !expandedComments.has(comment.id) }"
                >
                  <div
                    :ref="(el) => setCommentBodyRef(comment.id, el)"
                    class="comment-body-content"
                    v-html="renderMarkdown(comment.text)"
                  />
                </div>
                <button
                  v-if="overflowingComments.has(comment.id)"
                  class="expand-btn"
                  :aria-expanded="expandedComments.has(comment.id)"
                  :aria-controls="`comment-body-${comment.id}`"
                  @click="toggleCommentExpand(comment.id)"
                >
                  {{ expandedComments.has(comment.id) ? 'Show less' : 'Show more' }}
                </button>
              </template>
            </div>
          </div>
          <form class="add-comment" @submit.prevent="addComment">
            <CommentComposer
              v-model="newComment"
              :draft-key="addCommentDraftKey"
              :busy="submitting"
              @submit="addComment"
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
              <button type="submit" :aria-busy="submitting">Send</button>
            </div>
          </form>
        </details>
      </template>

      <!-- Fullscreen Image Viewer -->
      <div
        v-if="fullscreenImage"
        class="fullscreen-overlay"
        @click="fullscreenImage = null"
      >
        <button
          class="fullscreen-close"
          aria-label="Close"
          @click.stop="fullscreenImage = null"
        >
          ×
        </button>
        <img :src="fullscreenImage" class="fullscreen-image" @click.stop />
      </div>

      <!-- Delete Confirmation -->
      <dialog
        ref="deleteDialogEl"
        class="inner-dialog"
        @close="showDeleteConfirm = false"
      >
        <article>
          <header><h3>Delete Task</h3></header>
          <p>Are you sure you want to delete "{{ task?.title }}"?</p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button class="contrast" :aria-busy="deleting" @click="deleteTask">
              Delete
            </button>
          </footer>
        </article>
      </dialog>

      <!-- Cancel Confirmation -->
      <dialog
        ref="cancelDialogEl"
        class="inner-dialog"
        @close="showCancelConfirm = false"
      >
        <article>
          <header><h3>Cancel Task</h3></header>
          <p>
            Are you sure you want to cancel "{{ task?.title }}"? It will be
            moved to Done and its title suffixed with " [cancelled]".
          </p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showCancelConfirm = false">
              Keep Task
            </button>
            <button class="contrast" :aria-busy="cancelling" @click="cancelTask">
              Cancel Task
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
            <button class="secondary" @click="showDeleteCommentConfirm = false">
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
import { renderMarkdown } from "../composables/useMarkdown";
import { formatRelativeTime } from "../utils/relativeTime";
import {
  loadCommentDraft,
  clearCommentDraft,
} from "../composables/useCommentDraft";
import api from "../utils/api";
import { displayName } from "../utils/projectHierarchy";

const props = defineProps({
  taskId: { type: String, default: null },
  commentId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated", "cloned"]);

const route = useRoute();
const router = useRouter();

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => !!props.taskId);

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const authStore = useAuthStore();
const recommendationStore = useRecommendationStore();

const task = computed(() => tasksStore.currentTask);
const isImproveEnabled = computed(() => recommendationStore.isImproveEnabled);
const loading = ref(false);
const notFound = ref(false);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);
const showCancelConfirm = ref(false);
const cancelDialogEl = useModalDialog(() => showCancelConfirm.value);
const cancelling = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const newChecklistText = ref("");
const savingChecklist = ref(false);
const editing = ref(false);
const saving = ref(false);
const savingStatus = ref(false);
const cloning = ref(false);
const improving = ref(false);
const advancedMenuEl = ref(null);
const editForm = ref({
  title: "",
  description: "",
  priority: "",
  dueDate: "",
  assignees: [],
  projectId: "",
});
const authToken = computed(() => localStorage.getItem("token") || "");
const fullscreenImage = ref(null);
const users = ref([]);
// Long descriptions collapse behind a "Show more/less" disclosure in view
// mode; Edit mode always shows the full text (the textarea is untouched).
const {
  expanded: descriptionExpanded,
  overflowing: descriptionOverflowing,
  setContentEl: setDescriptionContentEl,
  toggle: toggleDescription,
  reset: resetDescriptionCollapse,
} = useOverflowCollapse();
const expandedComments = ref(new Set());
// Overflow detection: commentBodyEls holds the inner, unclipped content
// element of each comment; its height is the natural rendered height of
// the markdown (the outer .comment-body does the 2-line clip).
const commentBodyEls = new Map();
const overflowingComments = ref(new Set());
// Comment edit/delete state
const deletingCommentId = ref("");
const editingCommentId = ref("");
const editingCommentText = ref("");
const savingComment = ref(false);
// Comment delete runs through the custom inner-dialog confirm instead of
// browser confirm(); the pending id is kept until the user confirms
const showDeleteCommentConfirm = ref(false);
const deleteCommentDialogEl = useModalDialog(
  () => showDeleteCommentConfirm.value,
);
const pendingDeleteCommentId = ref("");
// Inline dismissible error banner replacing browser alert() in this dialog
const dialogError = ref("");
// A one-shot measurement races with dialog rendering: the <dialog> opens
// via showModal in a post-flush watcher, so content may still be
// display:none and report scrollHeight 0, hiding the expand button until
// something else re-measures. Observing each comment's content element
// re-measures whenever its box actually changes: dialog or <details>
// opening, image loading, text re-wrapping.
const commentResizeObserver = new ResizeObserver(measureComments);

// Remembered collapse state of the Checklist/Attachments/Comments sections
const {
  isSectionOpen,
  onSectionToggle,
  forceSectionOpen,
  reset: resetForcedSections,
} = useSectionState("planner.sectionState.taskDialog");

// Long threads show only the latest comments behind a one-way expander
const COMMENTS_VISIBLE_LIMIT = 20;
const showAllComments = ref(false);
const visibleComments = computed(() => {
  const comments = task.value?.comments || [];
  if (showAllComments.value || comments.length <= COMMENTS_VISIBLE_LIMIT) {
    return comments;
  }
  return comments.slice(-COMMENTS_VISIBLE_LIMIT);
});
const hiddenCommentsCount = computed(() => {
  const comments = task.value?.comments || [];
  if (showAllComments.value || comments.length <= COMMENTS_VISIBLE_LIMIT) {
    return 0;
  }
  return comments.length - COMMENTS_VISIBLE_LIMIT;
});

// Comment deep links (?taskId=…&commentId=…): scroll to and briefly
// highlight the anchored comment
const highlightedCommentId = ref("");
let highlightTimer = null;

const hasChecklist = computed(() => !!task.value?.checklist?.length);
const hasAttachments = computed(() => !!task.value?.attachments?.length);
const hasComments = computed(() => !!task.value?.comments?.length);
const checklistDoneCount = computed(() =>
  (task.value?.checklist || []).filter((i) => i.done).length,
);
const checklistPercent = computed(() =>
  hasChecklist.value
    ? Math.round((checklistDoneCount.value / task.value.checklist.length) * 100)
    : 0,
);

const statusColor = computed(() =>
  task.value ? statusesStore.colorFor(task.value.status) : "transparent",
);

// Due-date urgency against local today; never for Done tasks
const dueUrgency = computed(() => {
  const t = task.value;
  if (!t?.dueDate || t.status === "Done") return null;
  const parts = t.dueDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due.getTime() < today.getTime()) return "overdue";
  if (due.getTime() === today.getTime()) return "today";
  return null;
});
const dueUrgencyTitle = computed(() =>
  dueUrgency.value === "overdue"
    ? "This task is overdue"
    : dueUrgency.value === "today"
      ? "This task is due today"
      : null,
);

// localStorage draft keys: distinct add/edit namespaces under one prefix
const addCommentDraftKey = computed(() =>
  props.taskId ? `planner.commentDraft.task.${props.taskId}` : null,
);

function editCommentDraftKey(commentId) {
  return props.taskId
    ? `planner.commentDraft.task.${props.taskId}.edit.${commentId}`
    : null;
}

function setDialogError(e, fallback) {
  dialogError.value = e?.response?.data?.error || fallback;
}

function dismissDialogError() {
  dialogError.value = "";
}

const availableStatuses = computed(() => {
  if (!task.value) return ["To Do", "In Progress", "Done"];
  const project = projectsStore.projects.find(
    (p) => p.id === task.value.projectId,
  );
  return project?.statuses || ["To Do", "In Progress", "Done"];
});

const projectName = computed(() => {
  const project = projectsStore.projects.find(
    (p) => p.id === task.value?.projectId,
  );
  return project ? displayName(project.name) : "";
});

// Cancelling moves the task to Done and renames it, so hide the action for
// tasks already in Done and for tasks in archived projects, where the
// server rejects any task update ("Project is archived").
const canCancelTask = computed(() => {
  if (!task.value) return false;
  if (task.value.status === "Done") return false;
  const project = projectsStore.projects.find(
    (p) => p.id === task.value.projectId,
  );
  return !project?.archived;
});

// While the dialog is open, poll the task so changes made by other users
// show up without reopening it. The poll never runs while the user is
// editing or submitting: a re-fetch replaces currentTask and would fight
// the form. The server also sends push notifications on task updates;
// this poll covers users who have not opted in to notifications.
// Declared before the taskId watch below: that watch is immediate and its
// callback runs synchronously during setup, calling stopTaskPolling() —
// reading taskPollTimer before its declaration would be a TDZ error.
const TASK_POLL_INTERVAL = 60 * 1000;
let taskPollTimer = null;

function startTaskPolling() {
  stopTaskPolling();
  taskPollTimer = setInterval(pollTask, TASK_POLL_INTERVAL);
}

function stopTaskPolling() {
  if (taskPollTimer) {
    clearInterval(taskPollTimer);
    taskPollTimer = null;
  }
}

async function pollTask() {
  if (!props.taskId || loading.value || editing.value || submitting.value) {
    return;
  }
  try {
    await tasksStore.fetchById(props.taskId);
  } catch {
    // Transient polling errors are ignored; the next tick retries
  }
}

watch(
  () => props.taskId,
  async (newId) => {
    stopTaskPolling();
    // Reset per-task state before anything else: the deep-link override,
    // the thread collapse, the error banner, pending edit/delete state
    resetForcedSections();
    showAllComments.value = false;
    highlightedCommentId.value = "";
    if (highlightTimer) {
      clearTimeout(highlightTimer);
      highlightTimer = null;
    }
    dialogError.value = "";
    editingCommentId.value = "";
    editingCommentText.value = "";
    pendingDeleteCommentId.value = "";
    if (newId) {
      // The advanced menu needs the LLM config; fetch it when opening.
      recommendationStore.fetchConfig();
      // The status chip needs the statuses catalog on a cold deep link
      if (!statusesStore.catalog.length) {
        statusesStore.fetchAll().catch(() => {});
      }
      loading.value = true;
      editing.value = false;
      notFound.value = false;
      // Restore the add-comment draft first, under the NEW task's key, so
      // a task A→B switch can never write task A's text into B's draft
      newComment.value = loadCommentDraft(addCommentDraftKey.value);
      try {
        await tasksStore.fetchById(newId);
        await projectsStore.fetchAll();
      } catch (e) {
        // The task is missing or sits in a restricted project the user
        // cannot see (404): show a dedicated state instead of an empty body.
        if (e?.response?.status === 404) {
          notFound.value = true;
          tasksStore.currentTask = null;
        }
      } finally {
        loading.value = false;
      }
      if (!notFound.value) {
        startTaskPolling();
        if (props.commentId) {
          await handleCommentDeepLink();
        }
      }
    } else {
      tasksStore.currentTask = null;
    }
  },
  { immediate: true },
);

// A commentId arriving while the dialog is already open on this task
// (e.g. copying a comment link) re-runs the deep-link scroll/highlight;
// on a cold load the taskId watcher above handles it after the fetch.
watch(
  () => props.commentId,
  (newCommentId) => {
    if (newCommentId && task.value && task.value.id === props.taskId) {
      handleCommentDeepLink();
    }
  },
);

async function handleCommentDeepLink() {
  const commentId = props.commentId;
  if (!commentId || !task.value) return;
  const exists = (task.value.comments || []).some((c) => c.id === commentId);
  if (!exists) {
    // Unknown comment (deleted, or a stale link): strip the param so the
    // URL stays clean and shareable
    const query = { ...route.query };
    delete query.commentId;
    router.replace({ path: route.path, query });
    return;
  }
  // Force the Comments section open, overriding both the stored section
  // state and the long-thread collapse
  showAllComments.value = true;
  forceSectionOpen("comments");
  await nextTick();
  requestAnimationFrame(() => {
    const el = document.getElementById(`comment-${commentId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    highlightedCommentId.value = commentId;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedCommentId.value = "";
      highlightTimer = null;
    }, 2000);
  });
}

// Belt-and-braces alongside the ResizeObserver: re-measure after the
// comments have rendered. The observer remains the source of truth — it
// re-measures on every real layout change (dialog opening, image loads).
watch(
  () => task.value?.comments,
  async () => {
    await nextTick();
    measureComments();
  },
);

// Re-collapse the description when switching tasks or leaving Edit mode; the
// ResizeObserver re-measures overflow once the new content has rendered.
watch(
  () => [props.taskId, editing.value],
  async () => {
    await nextTick();
    resetDescriptionCollapse();
  },
);

function setCommentBodyRef(commentId, el) {
  if (el) {
    commentBodyEls.set(commentId, el);
    commentResizeObserver.observe(el);
  } else {
    const prev = commentBodyEls.get(commentId);
    if (prev) commentResizeObserver.unobserve(prev);
    commentBodyEls.delete(commentId);
  }
}

// Detect which comments actually overflow the 2-line collapsed height.
// Measuring the rendered height is more reliable than counting characters:
// markdown blocks (lists, code fences, headings) render at very different
// heights for the same text length.
function measureComments() {
  const overflowing = new Set();
  for (const [commentId, el] of commentBodyEls) {
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    // line-height may compute as a unitless number ("1.5"), a px value or
    // "normal" — normalize it against the font size
    let lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || lineHeight < fontSize) {
      lineHeight = fontSize * 1.5;
    }
    if (el.scrollHeight > lineHeight * 2 + 1) {
      overflowing.add(commentId);
    }
  }
  overflowingComments.value = overflowing;
}

onBeforeUnmount(() => {
  stopTaskPolling();
  commentResizeObserver.disconnect();
  if (highlightTimer) clearTimeout(highlightTimer);
});

function toggleCommentExpand(commentId) {
  const newSet = new Set(expandedComments.value);
  if (newSet.has(commentId)) {
    newSet.delete(commentId);
  } else {
    newSet.add(commentId);
  }
  expandedComments.value = newSet;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!task.value) return;
  editForm.value = {
    title: task.value.title,
    description: task.value.description,
    priority: task.value.priority,
    dueDate: task.value.dueDate || "",
    assignees: (task.value.assignees || []).map((a) => a.userId),
    projectId: task.value.projectId,
  };
  editing.value = true;
  // Fetch users for the assignee picker
  fetchUsers();
}

async function fetchUsers() {
  try {
    const res = await api.get("/users/picker");
    users.value = res.data;
  } catch {
    users.value = [];
  }
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!task.value) return;
  dialogError.value = "";
  saving.value = true;
  try {
    await tasksStore.update(props.taskId, {
      title: editForm.value.title,
      description: editForm.value.description,
      priority: editForm.value.priority,
      dueDate: editForm.value.dueDate || null,
      projectId: editForm.value.projectId,
    });
    // Update assignees separately
    const currentAssignees = (task.value.assignees || []).map((a) => a.userId);
    const newAssignees = editForm.value.assignees;
    // Remove assignees that are no longer selected
    for (const userId of currentAssignees) {
      if (!newAssignees.includes(userId)) {
        await tasksStore.removeAssignee(props.taskId, userId);
      }
    }
    // Add new assignees
    for (const userId of newAssignees) {
      if (!currentAssignees.includes(userId)) {
        await tasksStore.addAssignee(props.taskId, userId);
      }
    }
    // Refresh the task to get updated assignee names
    await tasksStore.fetchById(props.taskId);
    editing.value = false;
    emit("updated");
  } catch (e) {
    setDialogError(e, "Failed to update task");
  } finally {
    saving.value = false;
  }
}

async function onStatusChange(event) {
  if (!task.value) return;
  const newStatus = event.target.value;
  if (newStatus === task.value.status) return;
  dialogError.value = "";
  savingStatus.value = true;
  try {
    await tasksStore.update(props.taskId, { status: newStatus });
    emit("updated");
  } catch (e) {
    setDialogError(e, "Failed to update status");
  } finally {
    savingStatus.value = false;
  }
}

async function addComment() {
  if (!newComment.value.trim()) return;
  dialogError.value = "";
  submitting.value = true;
  try {
    await tasksStore.addComment(props.taskId, newComment.value);
    clearCommentDraft(addCommentDraftKey.value);
    newComment.value = "";
  } catch (e) {
    setDialogError(e, "Failed to add comment");
  } finally {
    submitting.value = false;
  }
}

function discardAddComment() {
  clearCommentDraft(addCommentDraftKey.value);
  newComment.value = "";
}

function canModifyComment(comment) {
  if (authStore.isAdmin) return true;
  return authStore.currentUser?.id === comment.userId;
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
    await tasksStore.deleteComment(props.taskId, commentId);
    showDeleteCommentConfirm.value = false;
    pendingDeleteCommentId.value = "";
  } catch (e) {
    setDialogError(e, "Failed to delete comment");
  } finally {
    deletingCommentId.value = "";
  }
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
    await tasksStore.updateComment(props.taskId, commentId, editingCommentText.value);
    clearCommentDraft(editCommentDraftKey(commentId));
    editingCommentId.value = "";
    editingCommentText.value = "";
  } catch (e) {
    setDialogError(e, "Failed to update comment");
  } finally {
    savingComment.value = false;
  }
}

async function copyCommentLink(commentId) {
  if (!props.taskId) return;
  dialogError.value = "";
  const query = { ...route.query, taskId: props.taskId, commentId };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  const url = `${window.location.origin}${route.path}?${params.toString()}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    setDialogError(null, "Failed to copy comment link");
  }
  // Reflect the deep link in the URL; stripped again on dialog close
  router.replace({ path: route.path, query });
}

async function toggleChecklist(idx) {
  if (!task.value) return;
  dialogError.value = "";
  const checklist = [...task.value.checklist];
  checklist[idx] = { ...checklist[idx], done: !checklist[idx].done };
  try {
    await tasksStore.update(props.taskId, { checklist });
  } catch (e) {
    setDialogError(e, "Failed to update checklist");
  }
}

async function deleteChecklistItem(idx) {
  if (!task.value) return;
  dialogError.value = "";
  const checklist = task.value.checklist.filter((_, i) => i !== idx);
  try {
    await tasksStore.update(props.taskId, { checklist });
  } catch (e) {
    setDialogError(e, "Failed to delete checklist item");
  }
}

async function addChecklistItem() {
  if (!task.value || !newChecklistText.value.trim()) return;
  dialogError.value = "";
  savingChecklist.value = true;
  try {
    await tasksStore.update(props.taskId, {
      checklist: [
        ...task.value.checklist,
        { text: newChecklistText.value.trim(), done: false },
      ],
    });
    newChecklistText.value = "";
  } catch (e) {
    setDialogError(e, "Failed to add checklist item");
  } finally {
    savingChecklist.value = false;
  }
}

function closeAdvancedMenu() {
  advancedMenuEl.value?.removeAttribute("open");
}

async function cloneTask() {
  closeAdvancedMenu();
  if (!task.value || cloning.value) return;
  dialogError.value = "";
  cloning.value = true;
  try {
    const newTask = await tasksStore.clone(props.taskId);
    // Re-point the dialog at the clone via the taskId query param
    emit("cloned", newTask.id);
  } catch (e) {
    setDialogError(e, "Failed to clone task");
  } finally {
    cloning.value = false;
  }
}

async function improveTask() {
  closeAdvancedMenu();
  if (!task.value || improving.value) return;
  dialogError.value = "";
  improving.value = true;
  try {
    const source = editing.value
      ? {
          title: editForm.value.title,
          description: editForm.value.description,
        }
      : {
          title: task.value.title,
          description: task.value.description,
        };
    const improved = await tasksStore.improveText(
      source.title,
      source.description,
    );
    // Apply into the edit form for review; never saved silently
    if (!editing.value) startEdit();
    editForm.value.title = improved.title || editForm.value.title;
    editForm.value.description =
      improved.description || editForm.value.description;
  } catch (e) {
    setDialogError(e, "Failed to improve task");
  } finally {
    improving.value = false;
  }
}

function openDeleteConfirm() {
  closeAdvancedMenu();
  showDeleteConfirm.value = true;
}

function openCancelConfirm() {
  closeAdvancedMenu();
  showCancelConfirm.value = true;
}

async function cancelTask() {
  if (!task.value || cancelling.value) return;
  dialogError.value = "";
  cancelling.value = true;
  try {
    const suffix = " [cancelled]";
    const newTitle = task.value.title.endsWith(suffix)
      ? task.value.title
      : task.value.title + suffix;
    await tasksStore.update(props.taskId, {
      status: "Done",
      title: newTitle,
    });
    showCancelConfirm.value = false;
    emit("updated");
  } catch (e) {
    setDialogError(e, "Failed to cancel task");
  } finally {
    cancelling.value = false;
  }
}

async function deleteTask() {
  dialogError.value = "";
  deleting.value = true;
  try {
    await tasksStore.remove(props.taskId);
    showDeleteConfirm.value = false;
    emit("close");
  } catch (e) {
    setDialogError(e, "Failed to delete task");
  } finally {
    deleting.value = false;
  }
}

async function uploadAttachment() {
  const input = fileInput.value;
  if (!input || !input.files || !input.files[0]) return;
  dialogError.value = "";
  uploading.value = true;
  try {
    await tasksStore.uploadAttachment(props.taskId, input.files[0]);
    input.value = "";
  } catch (e) {
    setDialogError(e, "Failed to upload file");
  } finally {
    uploading.value = false;
  }
}

function isImageFile(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "avif",
  ].includes(ext || "");
}

async function deleteAttachment(attachmentId) {
  dialogError.value = "";
  deletingAttachmentId.value = attachmentId;
  try {
    await tasksStore.deleteAttachment(props.taskId, attachmentId);
  } catch (e) {
    setDialogError(e, "Failed to delete attachment");
  } finally {
    deletingAttachmentId.value = "";
  }
}
</script>

<style scoped>
.task-not-found {
  text-align: center;
  color: var(--pico-muted-color);
  padding: var(--space-md) 0;
}

/* Status bar — always visible dropdown */
.status-bar {
  margin-bottom: var(--space-md);
}

.status-select {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
}

.status-select strong {
  flex-shrink: 0;
  font-size: var(--text-base);
}

.status-select select {
  margin: 0;
  flex: 1;
  min-width: 0;
}

/* Color chip reflecting the current status color */
.status-dot {
  width: 0.85em;
  height: 0.85em;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
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

.edit-section {
  margin-bottom: var(--space-sm);
}

.edit-section label {
  display: block;
  margin-bottom: var(--space-sm);
}

.edit-section label h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.edit-section textarea {
  min-height: 60px;
}

.meta-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  font-size: var(--text-base);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  /* The UserMultiSelect dropdown overflows this section: without this,
     the global `dialog article section` scroll rule (base.css) clips it */
  overflow: visible;
  max-height: none;
}

.meta-section .tag {
  /* Cancel the section's smaller font-size so tag pills keep their
     original em-based size (main.css sets .tag { font-size: var(--text-base) }) */
  font-size: 1em;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.meta-field select,
.meta-field input {
  margin: 0;
}

section {
  margin-bottom: var(--space-md);
}

section h4 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
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

/* Due-date urgency (never applied to Done tasks) */
.due-overdue {
  color: var(--color-danger);
  font-weight: var(--weight-semibold);
}

.due-today {
  color: var(--color-warning);
  font-weight: var(--weight-semibold);
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
  cursor: pointer;
  flex: 1;
  min-width: 0;
  margin: 0;
}

.checklist-item .done {
  text-decoration: line-through;
  color: var(--color-text-muted);
}

.checklist-item-delete {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-md);
  line-height: 1;
  padding: 0 var(--space-2xs);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.checklist-item:hover .checklist-item-delete,
.checklist-item:focus-within .checklist-item-delete {
  opacity: 1;
}

.checklist-item-delete:hover {
  color: var(--color-danger);
}

/* Thin done/total bar next to the section count badge */
.checklist-progress {
  width: 80px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-border);
  overflow: hidden;
}

.checklist-progress-fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width var(--transition-normal);
}

.add-checklist-item,
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

/* Deep-link highlight: brief fade from the accent back to the surface */
.comment-highlight {
  animation: comment-highlight-fade 2s ease-out;
}

@keyframes comment-highlight-fade {
  0%,
  40% {
    background: var(--color-primary-soft);
  }
  100% {
    background: var(--color-surface);
  }
}

.show-earlier-btn {
  margin: var(--space-xs) 0 0;
}

.comment-body,
.comment-edit-form {
  margin-left: var(--space-sm);
  border-left: 3px solid var(--color-border);
  padding-left: var(--space-sm);
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

/* Touch devices have no hover: keep the comment and checklist actions
   always visible */
@media (hover: none) {
  .comment-action-btn,
  .checklist-item-delete {
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

.comment-edit-form textarea {
  width: 100%;
  min-height: 60px;
  margin-bottom: var(--space-xs);
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
  /* flow-root keeps child margins from collapsing out of the container,
     which previously bled into the comment header and expand button */
  display: flow-root;
  font-size: var(--text-md);
  line-height: 1.5;
  overflow-wrap: break-word;
  min-width: 0;
}

/* Deterministic 2-line clip: exactly 2 lines at line-height 1.5.
   -webkit-line-clamp is unreliable when the element contains block
   children (lists, pre, headings) — it mis-measures and lets content
   overlap neighboring elements. */
.comment-body.is-truncated {
  max-height: 3em;
  overflow: hidden;
}

/* The measured content lives one level deeper than .markdown-body's
   direct-child rules, so re-apply the tight first/last spacing here.
   line-height and flow-root are pinned on the content element itself so
   the expand-button threshold always matches the visible 2-line clip. */
.comment-body-content {
  display: flow-root;
  line-height: 1.5;
}

.comment-body-content > :first-child {
  margin-top: 0;
}

.comment-body-content > :last-child {
  margin-bottom: 0;
}

/* .expand-btn (the comment/description "Show more" disclosure) is shared
   across the detail dialogs and lives in main.css. */

.text-muted {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
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
}

.attachment-preview {
  max-width: 60px;
  max-height: 60px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.small-btn {
  padding: 0.1em 0.4em;
  font-size: var(--text-base);
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

.compact-section .add-checklist-item,
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

/* Fullscreen image viewer */
.fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fullscreen-image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  cursor: default;
  border-radius: var(--radius-sm);
}

.fullscreen-close {
  position: fixed;
  top: var(--space-md);
  right: var(--space-md);
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 2.5em;
  height: 2.5em;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fullscreen-close:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
