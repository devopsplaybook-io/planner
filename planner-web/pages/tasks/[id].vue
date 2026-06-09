<template>
  <div class="task-detail">
    <div v-if="loading" class="loading-indicator"></div>

    <template v-else-if="task">
      <header class="detail-header">
        <div>
          <NuxtLink to="/tasks" class="back-link"
            ><i class="bi bi-arrow-left"></i> Tasks</NuxtLink
          >
          <hgroup>
            <h1>{{ task.title }}</h1>
            <p>{{ task.description }}</p>
          </hgroup>
        </div>
        <div class="header-actions">
          <span :class="'priority-' + task.priority">
            <i class="bi bi-flag"></i> {{ task.priority }}
          </span>
          <span class="status-badge">{{ task.status }}</span>
        </div>
      </header>

      <!-- Meta Info -->
      <section class="meta-section">
        <div v-if="task.dueDate"><strong>Due:</strong> {{ task.dueDate }}</div>
        <div v-if="task.assignees.length">
          <strong>Assignees:</strong>
          <span
            v-for="a in task.assignees"
            :key="a.userId"
            class="assignee-tag"
            >{{ a.userName || a.userId }}</span
          >
        </div>
        <div v-if="task.labels.length">
          <strong>Labels:</strong>
          <span v-for="l in task.labels" :key="l" class="label-tag">{{
            l
          }}</span>
        </div>
      </section>

      <!-- Checklist -->
      <section v-if="task.checklist.length">
        <h2>Checklist</h2>
        <div class="checklist">
          <label
            v-for="(item, idx) in task.checklist"
            :key="idx"
            class="checklist-item"
          >
            <input
              type="checkbox"
              :checked="item.done"
              @change="toggleChecklist(idx)"
            />
            <span :class="{ done: item.done }">{{ item.text }}</span>
          </label>
        </div>
      </section>

      <!-- Comments -->
      <section>
        <h2>Comments ({{ task.comments.length }})</h2>
        <div class="comments">
          <article
            v-for="comment in task.comments"
            :key="comment.id"
            class="comment"
          >
            <header>
              <strong>{{ comment.userName || comment.userId }}</strong>
              <small>{{ formatDate(comment.dateCreated) }}</small>
            </header>
            <p>{{ comment.text }}</p>
          </article>
          <div v-if="task.comments.length === 0" class="empty-state">
            No comments
          </div>
        </div>
        <form class="add-comment" @submit.prevent="addComment">
          <input
            v-model="newComment"
            type="text"
            placeholder="Add a comment..."
            required
          />
          <button type="submit" :aria-busy="submitting">Send</button>
        </form>
      </section>

      <!-- Delete -->
      <section>
        <button class="contrast" @click="showDeleteConfirm = true">
          <i class="bi bi-trash"></i> Delete Task
        </button>
      </section>
    </template>

    <!-- Delete Confirmation -->
    <dialog :open="showDeleteConfirm">
      <article>
        <header>
          <h3>Delete Task</h3>
        </header>
        <p>Are you sure you want to delete "{{ task?.title }}"?</p>
        <footer>
          <button class="secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="contrast" @click="deleteTask" :aria-busy="deleting">
            Delete
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const router = useRouter();
const route = useRoute();

const task = computed(() => tasksStore.currentTask);
const loading = ref(true);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);

onMounted(async () => {
  try {
    await tasksStore.fetchById(route.params.id);
  } catch {
    router.push("/tasks");
  } finally {
    loading.value = false;
  }
});

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function addComment() {
  submitting.value = true;
  try {
    await tasksStore.addComment(route.params.id, newComment.value);
    newComment.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
  } finally {
    submitting.value = false;
  }
}

async function toggleChecklist(idx) {
  if (!task.value) return;
  const checklist = [...task.value.checklist];
  checklist[idx] = { ...checklist[idx], done: !checklist[idx].done };
  try {
    await tasksStore.update(route.params.id, { checklist });
  } catch {
    // Handle error
  }
}

async function deleteTask() {
  deleting.value = true;
  try {
    await tasksStore.remove(route.params.id);
    router.push("/tasks");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete task");
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
  }
}
</script>

<style scoped>
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1em;
  flex-wrap: wrap;
  gap: 0.5em;
}

.back-link {
  text-decoration: none;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.3em;
}

.header-actions {
  display: flex;
  gap: 0.5em;
  align-items: center;
}

.priority-high {
  color: var(--pico-del-color);
}
.priority-medium {
  color: var(--pico-primary);
}
.priority-low {
  color: var(--pico-muted-color);
}

.status-badge {
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

.meta-section {
  display: flex;
  flex-wrap: wrap;
  gap: 1em;
  margin-bottom: 1.5em;
  padding: 0.5em;
  background: var(--pico-card-background-color);
  border-radius: 0.3em;
}

.assignee-tag,
.label-tag {
  display: inline-block;
  padding: 0.1em 0.4em;
  margin: 0.1em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

section {
  margin-bottom: 1.5em;
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 0.5em;
  cursor: pointer;
}

.checklist-item .done {
  text-decoration: line-through;
  color: var(--pico-muted-color);
}

.comments {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  margin-bottom: 0.5em;
}

.comment {
  padding: 0.3em 0.5em;
}

.comment header {
  display: flex;
  justify-content: space-between;
  padding: 0;
  height: auto;
  margin-bottom: 0.2em;
}

.comment p {
  margin: 0;
  font-size: 0.9em;
}

.add-comment {
  display: flex;
  gap: 0.5em;
}

.add-comment input {
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 1em;
  color: var(--pico-muted-color);
  font-size: 0.9em;
}

dialog article footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
}
</style>
