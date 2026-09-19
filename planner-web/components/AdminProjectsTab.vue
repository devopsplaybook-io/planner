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
      <div
        v-for="node in projectNodes"
        :key="node.project.id"
        class="project-slot"
        :style="{ '--depth': node.depth }"
      >
        <i
          v-if="node.orphan"
          class="bi bi-exclamation-triangle orphan-warning"
          title="Parent project not found"
        />
        <ProjectCard
          :project="node.project"
          @click="openProject(node.project.id)"
        />
      </div>
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
import {
  buildProjectTree,
  flattenProjectTree,
  normalizeName,
} from "../utils/projectHierarchy";

const projectsStore = useProjectsStore();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const showCreateDialog = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const createDialogEl = useModalDialog(() => showCreateDialog.value);
const creating = ref(false);
const newProject = ref({ name: "", description: "" });

// Tree order (parents before their sub-projects) with the depth driving the
// indentation; orphaned projects render at the root with a warning
const projectNodes = computed(() =>
  flattenProjectTree(buildProjectTree(projectsStore.projects)),
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

.project-slot {
  position: relative;
  /* Indentation per hierarchy depth (depth 0 = root) */
  margin-left: calc(var(--depth, 0) * 1.25rem);
}

.orphan-warning {
  position: absolute;
  top: -0.6em;
  right: 0.5em;
  z-index: 1;
  color: var(--color-warning, #b58900);
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
