<template>
  <section>
    <header class="section-header">
      <h2>Statuses</h2>
    </header>

    <p class="section-hint">
      Drag to reorder. Click a color chip to choose the status color.
      <strong>Done</strong> is always last and cannot be removed. A status
      still used by a project cannot be deleted.
    </p>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <div class="status-editor">
        <template v-for="(status, idx) in editableStatuses" :key="status.name">
          <div
            class="status-row"
            :class="{
              'is-dragging': dragStatusIdx === idx,
              'is-done-row': status.name === 'Done',
            }"
            :draggable="status.name !== 'Done'"
            @dragstart="onStatusDragStart($event, idx)"
            @dragover.prevent="onStatusDragOver(idx)"
            @dragenter.prevent="onStatusDragOver(idx)"
            @drop="onStatusDrop(idx)"
            @dragend="dragStatusIdx = null"
          >
            <span class="drag-handle" v-if="status.name !== 'Done'">
              <i class="bi bi-grip-vertical" />
            </span>
            <button
              type="button"
              class="status-color-chip"
              :class="{ 'is-open': pickerIdx === idx }"
              :style="{ backgroundColor: status.color }"
              title="Choose color"
              :aria-label="`Choose color for ${status.name}`"
              @click="togglePicker(idx)"
            />
            <span class="status-name">{{ status.name }}</span>
            <span v-if="status.name === 'Done'" class="done-lock">
              <i class="bi bi-lock-fill" /> Mandatory
            </span>
            <button
              v-if="status.name !== 'Done'"
              type="button"
              class="small secondary remove-status-btn"
              title="Remove status"
              @click="removeStatus(idx)"
            >
              <i class="bi bi-x" />
            </button>
          </div>
          <div v-if="pickerIdx === idx" class="status-picker-row">
            <StatusColorPicker
              v-model="status.color"
              @select="pickerIdx = null"
            />
          </div>
        </template>
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
import { DEFAULT_STATUS_COLOR } from "../stores/statuses";

const statusesStore = useStatusesStore();

const loading = ref(true);
const editableStatuses = ref([]);
const newStatusText = ref("");
const dragStatusIdx = ref(null);
const pickerIdx = ref(null);
const saving = ref(false);
const statusError = ref("");
const saveSuccess = ref(false);

function togglePicker(idx) {
  pickerIdx.value = pickerIdx.value === idx ? null : idx;
}

function addStatus() {
  const text = newStatusText.value.trim();
  if (!text) return;
  statusError.value = "";
  saveSuccess.value = false;
  if (editableStatuses.value.some((s) => s.name === text)) {
    statusError.value = "This status already exists.";
    return;
  }
  // Insert before "Done" (always last)
  const doneIdx = editableStatuses.value.findIndex((s) => s.name === "Done");
  const entry = { name: text, color: DEFAULT_STATUS_COLOR };
  if (doneIdx >= 0) {
    editableStatuses.value.splice(doneIdx, 0, entry);
  } else {
    editableStatuses.value.push(entry);
  }
  newStatusText.value = "";
}

function removeStatus(idx) {
  if (editableStatuses.value[idx].name === "Done") return;
  statusError.value = "";
  saveSuccess.value = false;
  if (pickerIdx.value === idx) {
    pickerIdx.value = null;
  }
  editableStatuses.value.splice(idx, 1);
}

function onStatusDragStart(event, idx) {
  if (editableStatuses.value[idx].name === "Done") return;
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
  if (editableStatuses.value[targetIdx].name === "Done") return;
  const item = editableStatuses.value.splice(srcIdx, 1)[0];
  editableStatuses.value.splice(targetIdx, 0, item);
}

async function saveStatuses() {
  statusError.value = "";
  saveSuccess.value = false;
  const statuses = editableStatuses.value.filter((s) => s.name);
  if (!statuses.some((s) => s.name === "Done")) {
    statuses.push({ name: "Done", color: DEFAULT_STATUS_COLOR });
  }
  if (statuses.length < 2) {
    statusError.value =
      'At least one status besides "Done" is required.';
    return;
  }
  if (statuses[statuses.length - 1].name !== "Done") {
    const doneIdx = statuses.findIndex((s) => s.name === "Done");
    const [done] = statuses.splice(doneIdx, 1);
    statuses.push(done);
  }
  saving.value = true;
  try {
    const saved = await statusesStore.save(statuses);
    editableStatuses.value = saved.map((s) => ({ ...s }));
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
    editableStatuses.value = statusesStore.catalog.map((s) => ({ ...s }));
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

.status-color-chip {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.1s;
}

.status-color-chip:hover {
  transform: scale(1.12);
}

.status-color-chip.is-open {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.status-picker-row {
  padding: var(--space-2xs) 0 var(--space-2xs) var(--space-lg);
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
