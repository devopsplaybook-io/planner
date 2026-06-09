<template>
  <div class="projects-page">
    <header class="page-header">
      <hgroup>
        <h1>Projects</h1>
        <p>Manage your projects</p>
      </hgroup>
      <button class="fab-button" @click="showCreateDialog = true">
        <i class="bi bi-plus-lg"></i>
      </button>
    </header>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else class="project-grid">
      <article
        v-for="project in projectsStore.projects"
        :key="project.id"
        class="project-card"
        @click="router.push(`/projects/${project.id}`)"
      >
        <header>
          <h3>{{ project.name }}</h3>
          <span v-if="project.isDefault" class="badge">Default</span>
        </header>
        <p v-if="project.description">{{ project.description }}</p>
        <footer>
          <small>{{ project.statuses?.length || 0 }} statuses</small>
        </footer>
      </article>
    </div>

    <!-- Create Dialog -->
    <dialog :open="showCreateDialog">
      <article>
        <header>
          <h3>Create Project</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          ></button>
        </header>
        <form @submit.prevent="createProject">
          <label>
            Name
            <input
              v-model="newProject.name"
              type="text"
              required
              placeholder="Project name"
            />
          </label>
          <label>
            Description
            <textarea
              v-model="newProject.description"
              placeholder="Optional description"
            ></textarea>
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
const projectsStore = useProjectsStore();
const router = useRouter();

const loading = ref(true);
const showCreateDialog = ref(false);
const creating = ref(false);
const newProject = ref({ name: "", description: "" });

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

async function createProject() {
  creating.value = true;
  try {
    await projectsStore.create(
      newProject.value.name,
      newProject.value.description,
    );
    showCreateDialog.value = false;
    newProject.value = { name: "", description: "" };
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create project");
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

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1em;
}

.project-card {
  cursor: pointer;
  transition: transform 0.1s;
}

.project-card:hover {
  transform: translateY(-2px);
}

.project-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  height: auto;
}

.project-card header h3 {
  margin: 0;
  font-size: 1em;
}

.project-card footer {
  padding: 0;
}

.badge {
  font-size: 0.75em;
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
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
