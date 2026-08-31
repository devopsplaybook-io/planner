<template>
  <div class="projects-page">
    <header class="page-header">
      <hgroup>
        <h1>Projects</h1>
        <p>Manage your projects</p>
      </hgroup>
      <button class="fab-button" @click="showCreateDialog = true">
        <i class="bi bi-plus-lg" />
      </button>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="project-grid">
      <ProjectCard
        v-for="project in projectsStore.projects"
        :key="project.id"
        :project="project"
        @click="router.push(`/projects/${project.id}`)"
      />
    </div>

    <!-- Create Dialog -->
    <dialog
      ref="createDialogEl"
      @close="showCreateDialog = false"
    >
      <article>
        <header>
          <h3>Create Project</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          />
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
            />
          </label>
          <footer class="dialog-footer">
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
// Modal dialog wiring: backdrop, focus trap, Escape to close
const createDialogEl = useModalDialog(() => showCreateDialog.value);
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
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
}
</style>
