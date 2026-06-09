<template>
  <div class="note-detail">
    <div v-if="loading" class="loading-indicator"></div>

    <template v-else-if="note">
      <header class="detail-header">
        <div>
          <NuxtLink to="/notes" class="back-link"
            ><i class="bi bi-arrow-left"></i> Notes</NuxtLink
          >
          <hgroup>
            <h1>{{ note.title }}</h1>
          </hgroup>
        </div>
        <div class="header-actions">
          <button class="secondary" @click="showDeleteConfirm = true">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </header>

      <!-- Description -->
      <section>
        <p class="note-description">{{ note.description }}</p>
      </section>

      <!-- Labels -->
      <section v-if="note.labels.length">
        <div class="labels">
          <span v-for="l in note.labels" :key="l" class="label-tag">{{
            l
          }}</span>
        </div>
      </section>

      <!-- Comments -->
      <section>
        <h2>Comments ({{ note.comments.length }})</h2>
        <div class="comments">
          <article
            v-for="comment in note.comments"
            :key="comment.id"
            class="comment"
          >
            <header>
              <strong>{{ comment.userName || comment.userId }}</strong>
              <small>{{ formatDate(comment.dateCreated) }}</small>
            </header>
            <p>{{ comment.text }}</p>
          </article>
          <div v-if="note.comments.length === 0" class="empty-state">
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
    </template>

    <!-- Delete Confirmation -->
    <dialog :open="showDeleteConfirm">
      <article>
        <header>
          <h3>Delete Note</h3>
        </header>
        <p>Are you sure you want to delete "{{ note?.title }}"?</p>
        <footer>
          <button class="secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="contrast" @click="deleteNote" :aria-busy="deleting">
            Delete
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const notesStore = useNotesStore();
const router = useRouter();
const route = useRoute();

const note = computed(() => notesStore.currentNote);
const loading = ref(true);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);

onMounted(async () => {
  try {
    await notesStore.fetchById(route.params.id);
  } catch {
    router.push("/notes");
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
    await notesStore.addComment(route.params.id, newComment.value);
    newComment.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
  } finally {
    submitting.value = false;
  }
}

async function deleteNote() {
  deleting.value = true;
  try {
    await notesStore.remove(route.params.id);
    router.push("/notes");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete note");
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
}

.note-description {
  white-space: pre-wrap;
  line-height: 1.5;
}

.labels {
  display: flex;
  gap: 0.3em;
  flex-wrap: wrap;
  margin-bottom: 1em;
}

.label-tag {
  display: inline-block;
  padding: 0.1em 0.4em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

section {
  margin-bottom: 1.5em;
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
