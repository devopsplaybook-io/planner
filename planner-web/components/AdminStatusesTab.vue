<template>
  <section>
    <header class="section-header">
      <h2>Statuses</h2>
    </header>

    <p class="section-hint">
      Drag to reorder. <strong>Done</strong> is always last and cannot be
      removed. A status still used by a project cannot be deleted.
    </p>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <div class="status-editor">
        <div
          v-for="(status, idx) in editableStatuses"
          :key="status"
          class="status-row"
          :class="{
            'is-dragging': dragStatusIdx === idx,
            'is-done-row': status === 'Done',
          }"
          :draggable="status !== 'Done'"
          @dragstart="onStatusDragStart($event, idx)"
          @dragover.prevent="onStatusDragOver(idx)"
          @dragenter.prevent="onStatusDragOver(idx)"
          @drop="onStatusDrop(idx)"
          @dragend="dragStatusIdx = null"
        >
          <span class="drag-handle" v-if="status !== 'Done'">
            <i class="bi bi-grip-vertical" />
          </span>
          <span class="status-name">{{ status }}</span>
          <span v-if="status === 'Done'" class="done-lock">
            <i class="bi bi-lock-fill" /> Mandatory
          </span>
          <button
            v-if="status !== 'Done'"
            type="button"
            class="small secondary remove-status-btn"
            title="Remove status"
            @click="removeStatus(idx)"
          >
            <i class="bi bi-x" />
          </button>
        </div>
      </div>

      <div class="add-status-row">
        <input
          v-model="newStatusText"
          type="text"
          placeholder="New status name…"
          @keyup.enter="addStatus"
        />
        <button type="button" class="small" @click="addStatus">
          <i class="bi bi-plus" /> Add
        </button>
      </div>

      <div v-if="statusError" class="status-error">
        <i class="bi bi-exclamation-circle" /> {{ statusError }}
      </div>
      <div v-if="saveSuccess" class="status-success">
        <i class="bi bi-check-circle" /> Statuses saved
      </div>

      <button
        type="button"
        :aria-busy="saving"
        class="save-statuses-btn"
        @click="saveStatuses"
      >
        <i class="bi bi-check-lg" /> Save statuses
      </button>
    </template>
  </section>
</template>

<script setup>
const statusesStore = useStatusesStore();

const loading = ref(true);
const editableStatuses = ref([]);
const newStatusText = ref("");
const dragStatusIdx = ref(null);
const saving = ref(false);
const statusError = ref("");
const saveSuccess = ref(false);

function addStatus() {
  const text = newStatusText.value.trim();
  if (!text) return;
  statusError.value = "";
  saveSuccess.value = false;
  if (editableStatuses.value.includes(text)) {
    statusError.value = "This status already exists.";
    return;
  }
  // Insert before "Done" (always last)
  const doneIdx = editableStatuses.value.indexOf("Done");
  if (doneIdx >= 0) {
    editableStatuses.value.splice(doneIdx, 0, text);
  } else {
    editableStatuses.value.push(text);
  }
  newStatusText.value = "";
}

function removeStatus(idx) {
  if (editableStatuses.value[idx] === "Done") return;
  statusError.value = "";
  saveSuccess.value = false;
  editableStatuses.value.splice(idx, 1);
}

function onStatusDragStart(event, idx) {
  if (editableStatuses.value[idx] === "Done") return;
  dragStatusIdx.value = idx;
  event.dataTransfer.effectAllowed = "move";
}

function onStatusDragOver(_idx) {
  // no-op, handled by prevent modifier
}

function onStatusDrop(targetIdx) {
  const srcIdx = dragStatusIdx.value;
  dragStatusIdx.value = null;
  if (srcIdx === null || srcIdx === targetIdx) return;
  if (editableStatuses.value[targetIdx] === "Done") return;
  const item = editableStatuses.value.splice(srcIdx, 1)[0];
  editableStatuses.value.splice(targetIdx, 0, item);
}

async function saveStatuses() {
  statusError.value = "";
  saveSuccess.value = false;
  const statuses = editableStatuses.value.filter(Boolean);
  if (!statuses.includes("Done")) {
    statuses.push("Done");
  }
  if (statuses.length < 2) {
    statusError.value =
      'At least one status besides "Done" is required.';
    return;
  }
  if (statuses[statuses.length - 1] !== "Done") {
    const doneIdx = statuses.indexOf("Done");
    statuses.splice(doneIdx, 1);
    statuses.push("Done");
  }
  saving.value = true;
  try {
    editableStatuses.value = await statusesStore.save(statuses);
    saveSuccess.value = true;
  } catch (e) {
    statusError.value =
      e.response?.data?.error || "Failed to save statuses";
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await statusesStore.fetchAll();
    editableStatuses.value = [...statusesStore.catalog];
  } catch {
    statusError.value = "Failed to load statuses";
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.section-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.status-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--space-sm);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  transition:
    background 0.12s,
    box-shadow 0.12s;
  user-select: none;
}

.status-row[draggable="true"] {
  cursor: grab;
}

.status-row[draggable="true"]:active {
  cursor: grabbing;
}

.status-row.is-dragging {
  opacity: 0.4;
  box-shadow: 0 0 0 2px var(--color-primary);
}

.status-row.is-done-row {
  opacity: 0.75;
  border-style: dashed;
  background: transparent;
}

.drag-handle {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.status-name {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}

.done-lock {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-left: auto;
}

.remove-status-btn {
  margin-left: auto;
  padding: 0 var(--space-2xs) !important;
  line-height: var(--leading-none);
  font-size: var(--text-default) !important;
}

.add-status-row {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.add-status-row input {
  flex: 1;
  margin: 0;
}

.status-error {
  font-size: var(--text-base);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.status-success {
  font-size: var(--text-base);
  color: var(--color-success, var(--color-primary));
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.save-statuses-btn {
  margin-top: var(--space-xs);
}
</style>
