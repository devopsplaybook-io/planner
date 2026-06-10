<template>
  <div class="notes-page">
    <header class="page-header">
      <hgroup>
        <h1>Notes</h1>
        <p>Free-form notes</p>
      </hgroup>
      <button class="fab-button" @click="showCreateDialog = true">
        <i class="bi bi-plus-lg"/>
      </button>
    </header>

    <div v-if="loading" class="loading-indicator"/>

    <div v-else class="note-list">
      <article
        v-for="note in notesStore.notes"
        :key="note.id"
        class="note-card"
        @click="router.push(`/notes/${note.id}`)"
      >
        <header>
          <h3>{{ note.title }}</h3>
          <small>{{ formatDate(note.dateCreated) }}</small>
        </header>
        <p v-if="note.description" class="note-desc">
          {{ truncate(note.description, 150) }}
        </p>
        <footer>
          <span v-for="l in note.labels" :key="l" class="label-tag">{{
            l
          }}</span>
          <small v-if="note.comments.length">
            <i class="bi bi-chat"/> {{ note.comments.length }}
          </small>
        </footer>
      </article>
    </div>

    <!-- Create Dialog -->
    <dialog :open="showCreateDialog">
      <article>
        <header>
          <h3>Create Note</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          />
        </header>
        <form @submit.prevent="createNote">
          <label>
            Project
            <select v-model="newNote.projectId" required>
              <option
                v-for="p in projectsStore.projects"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option>
            </select>
          </label>
          <label>
            Title
            <input
              v-model="newNote.title"
              type="text"
              required
              placeholder="Note title"
            >
          </label>
          <label>
            Description
            <textarea
              v-model="newNote.description"
              placeholder="Note content"
              rows="5"
            />
          </label>
          <footer>
            <button type="submit" :aria-busy="creating">Create</button>
            <button
              class="secondary"
              type="button"
              @click="showCreateDialog = false"
            >
              Cancel
            </button>
          </footer>
        </form>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const notesStore = useNotesStore();
const projectsStore = useProjectsStore();
const router = useRouter();

const loading = ref(true);
const showCreateDialog = ref(false);
const creating = ref(false);
const newNote = ref({ projectId: "", title: "", description: "" });

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
}

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
    if (projectsStore.projects.length > 0) {
      newNote.value.projectId =
        projectsStore.defaultProject?.id || projectsStore.projects[0].id;
    }
    await notesStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

async function createNote() {
  creating.value = true;
  try {
    await notesStore.create(newNote.value);
    showCreateDialog.value = false;
    newNote.value = { projectId: "", title: "", description: "" };
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create note");
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1em;
}

.note-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0.5em;
}

.note-card {
  cursor: pointer;
}

.note-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  height: auto;
}

.note-card header h3 {
  margin: 0;
  font-size: 1em;
}

.note-desc {
  margin-top: 0.3em;
  font-size: 0.9em;
  color: var(--pico-muted-color);
}

.note-card footer {
  display: flex;
  gap: 0.3em;
  align-items: center;
  flex-wrap: wrap;
  padding: 0;
  margin-top: 0.3em;
}

.label-tag {
  display: inline-block;
  padding: 0.1em 0.4em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.8em;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5em;
  cursor: pointer;
}

dialog article footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
}
</style>
