<template>
  <section>
    <header class="section-header">
      <h2>Projects</h2>
      <button @click="showCreateDialog = true">
        <i class="bi bi-plus-lg" /> Add Project
      </button>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="project-grid">
      <ProjectTreeBranch
        v-for="root in projectTree"
        :key="root.project.id"
        :node="root"
        @open="openProject"
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
            <small v-if="namePreview" class="name-preview">
              Will be saved as: <strong>{{ namePreview }}</strong>
            </small>
            <small v-if="nameConflict" class="name-conflict">
              A project with this name already exists
            </small>
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
  </section>
</template>

<script setup>
import { buildProjectTree, normalizeName } from "../utils/projectHierarchy";

const projectsStore = useProjectsStore();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const showCreateDialog = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const createDialogEl = useModalDialog(() => showCreateDialog.value);
const creating = ref(false);
const newProject = ref({ name: "", description: "" });

// Tree order (parents before their sub-projects); orphaned projects render
// at the root with a warning, archived projects stay at the end. The
// recursive ProjectTreeBranch renders each parent followed by a nested,
// indented group of its children so the hierarchy is visible on desktop too.
const projectTree = computed(() =>
  buildProjectTree(projectsStore.projects),
);

const namePreview = computed(() => normalizeName(newProject.value.name));
const nameConflict = computed(
  () =>
    namePreview.value !== "" && projectsStore.isNameTaken(namePreview.value),
);

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

// Project cards read from the store, but refresh on dialog close to catch
// changes made by other users while the project dialog was open
useDialogCloseRefresh("projectId", () => projectsStore.fetchAll());

// Project detail opens in the global dialog via the ?projectId= query param,
// so the URL can be shared and restored on refresh
function openProject(id) {
  router.replace({
    path: route.path,
    query: { ...route.query, projectId: id },
  });
}

async function createProject() {
  if (nameConflict.value) {
    return;
  }
  creating.value = true;
  try {
    // The name is stored normalized (trimmed segments, no empty ones)
    await projectsStore.create(
      namePreview.value,
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

.name-preview {
  display: block;
  margin-top: var(--space-2xs);
  color: var(--color-text-muted);
}

.name-preview strong {
  color: var(--color-text);
}

.name-conflict {
  display: block;
  margin-top: var(--space-2xs);
  color: var(--color-danger);
}
</style>
