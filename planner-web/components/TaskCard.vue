<template>
  <div
    class="task-card"
    :class="[
      `priority-${task.priority}`,
      `status-${statusClass}`,
      { 'is-done': task.status === 'Done', 'is-dragging': isDragging },
    ]"
    :draggable="draggable"
    @click.stop="$emit('click', task)"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <div class="card-accent" />
    <div class="card-body">
      <header>
        <div class="card-title-row">
          <span class="task-icon"><i class="bi bi-kanban" /></span>
          <span class="task-title">{{ task.title }}</span>
        </div>
        <span class="status-badge">{{ task.status }}</span>
        <div class="card-meta">
          <small
            v-if="task.dueDate"
            class="due-date"
            :title="'Due: ' + task.dueDate"
          >
            <i class="bi bi-calendar3" /> {{ task.dueDate }}
          </small>
          <small
            v-if="task.assignees && task.assignees.length"
            class="assignee-count"
          >
            <i class="bi bi-people-fill" /> {{ task.assignees.length }}
          </small>
          <small
            v-if="task.checklist && task.checklist.length"
            class="checklist-progress"
          >
            <i class="bi bi-list-check" />
            {{ task.checklist.filter((c) => c.done).length }}/{{
              task.checklist.length
            }}
          </small>
        </div>
      </header>
      <footer v-if="task.labels && task.labels.length">
        <span v-for="l in task.labels" :key="l" class="label-tag">{{ l }}</span>
      </footer>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  task: { type: Object, required: true },
  draggable: { type: Boolean, default: false },
});

const emit = defineEmits(["click", "dragstart", "dragend"]);

const isDragging = ref(false);

const statusClass = computed(() => {
  return (props.task.status || "todo").toLowerCase().replace(/\s+/g, "-");
});

function onDragStart(event) {
  isDragging.value = true;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", props.task.id);
  emit("dragstart", event, props.task);
}

function onDragEnd(event) {
  isDragging.value = false;
  emit("dragend", event, props.task);
}
</script>

<style scoped>
.task-card {
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow var(--transition-fast),
    transform var(--transition-fast),
    opacity var(--transition-fast);
  user-select: none;
}

.task-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.task-card.is-dragging {
  opacity: 0.4;
  box-shadow: 0 0 0 2px var(--color-primary);
}

.task-card.is-done {
  opacity: 0.6;
}

/* Left accent stripe */
.card-accent {
  flex-shrink: 0;
  width: 5px;
  align-self: stretch;
}

.priority-high .card-accent {
  background: var(--color-danger);
}
.priority-medium .card-accent {
  background: var(--color-primary);
}
.priority-low .card-accent {
  background: var(--color-text-muted);
}

.card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 4px);
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  min-width: 0;
  font-size: var(--text-md);
}

.card-body header {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 4px);
  padding: 0;
  margin: 0;
  height: auto;
  background: none;
  border: none;
  border-radius: 0;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.task-icon {
  color: var(--color-text-muted);
  font-size: var(--text-base);
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.task-title {
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  line-height: var(--leading-compact);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* Status badge with distinct colors per status */
.status-badge {
  align-self: flex-start;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
  color: #fff;
  white-space: nowrap;
}

.status-to-do .status-badge {
  background: var(--color-status-todo);
}
.status-in-progress .status-badge {
  background: var(--color-status-progress);
}
.status-done .status-badge {
  background: var(--color-status-done);
}
.status-in-review .status-badge,
.status-review .status-badge {
  background: var(--color-status-review);
}
.status-blocked .status-badge {
  background: var(--color-status-blocked);
}

.card-meta {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.due-date,
.assignee-count,
.checklist-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: inherit;
}

.card-body footer {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  padding: 0;
  margin: 0;
  margin-top: var(--space-xs);
  background: none;
  border: none;
  border-radius: 0;
}

.label-tag {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 0.1em 0.4em;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
  white-space: nowrap;
}
</style>
