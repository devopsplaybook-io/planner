<template>
  <dialog :open="!!projectId">
    <article class="project-detail-dialog">
      <header class="dialog-header">
        <h3>Project Details</h3>
        <div class="dialog-actions">
          <button v-if="!editing" class="secondary" @click="startEdit">
            <i class="bi bi-pencil" /> Edit
          </button>
          <template v-if="editing">
            <button :aria-busy="saving" @click="saveEdit">
              <i class="bi bi-check" /> Save
            </button>
            <button class="secondary" @click="cancelEdit">
              <i class="bi bi-x" /> Cancel
            </button>
          </template>
          <button class="close-btn" aria-label="Close" @click="handleClose">
            ×
          </button>
        </div>
      </header>

      <section v-if="loading" class="loading-indicator" />

      <template v-else-if="project">
        <!-- Editable Fields -->
        <section class="edit-section">
          <label>
            Name
            <input
              v-if="editing"
              v-model="editForm.name"
              type="text"
              required
            />
            <h2 v-else>{{ project.name }}</h2>
          </label>
          <label>
            Description
            <textarea v-if="editing" v-model="editForm.description" rows="3" />
            <div
              v-else
              class="markdown-body"
              v-html="renderMarkdown(project.description) || 'No description'"
            />
          </label>
        </section>

        <!-- Meta Info -->
        <section class="meta-section">
          <div class="meta-field">
            <strong>Visibility</strong>
            <span>
              <i
                :class="
                  project.visibility === 'restricted'
                    ? 'bi bi-lock'
                    : 'bi bi-globe'
                "
              />
              {{ project.visibility || "public" }}
            </span>
          </div>
          <div class="meta-field">
            <strong>Statuses</strong>
            <span>{{ project.statuses?.length || 0 }} defined</span>
          </div>
          <div v-if="project.isDefault" class="meta-field">
            <span class="badge">Default project</span>
          </div>
        </section>

        <!-- Delete -->
        <section v-if="!project.isDefault">
          <button class="contrast" @click="showDeleteConfirm = true">
            <i class="bi bi-trash" /> Delete Project
          </button>
        </section>
      </template>

      <!-- Delete Confirmation -->
      <dialog :open="showDeleteConfirm" class="inner-dialog">
        <article>
          <header><h3>Delete Project</h3></header>
          <p>
            Are you sure you want to delete "{{ project?.name }}"? All
            associated tasks, notes, and comments will also be deleted.
          </p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button
              class="contrast"
              :aria-busy="deleting"
              @click="deleteProject"
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

const props = defineProps({
  projectId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated"]);

const projectsStore = useProjectsStore();

const project = computed(() => projectsStore.currentProject);
const loading = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editForm = ref({ name: "", description: "" });

watch(
  () => props.projectId,
  async (newId) => {
    if (newId) {
      loading.value = true;
      editing.value = false;
      try {
        await projectsStore.fetchById(newId);
      } catch {
        // Error fetching project
      } finally {
        loading.value = false;
      }
    } else {
      projectsStore.currentProject = null;
    }
  },
  { immediate: true },
);

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!project.value) return;
  editForm.value = {
    name: project.value.name,
    description: project.value.description || "",
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!project.value) return;
  saving.value = true;
  try {
    await projectsStore.update(props.projectId, {
      name: editForm.value.name,
      description: editForm.value.description,
    });
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update project");
  } finally {
    saving.value = false;
  }
}

async function deleteProject() {
  deleting.value = true;
  try {
    await projectsStore.remove(props.projectId);
    showDeleteConfirm.value = false;
    emit("close");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete project");
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h3 {
  margin: 0;
}

.dialog-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.edit-section {
  margin-bottom: var(--space-lg);
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
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  padding: var(--space-sm);
  background: var(--pico-card-background-color);
  border-radius: var(--radius-sm);
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.badge {
  font-size: var(--text-sm);
  padding: 0.2em 0.5em;
  border-radius: var(--radius-sm);
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
}

section {
  margin-bottom: var(--space-lg);
}

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}
</style>
