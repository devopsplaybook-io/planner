<template>
  <article
    class="task-card"
    :class="[
      `priority-${task.priority}`,
      { 'is-done': task.status === 'Done' },
    ]"
    @click="$emit('click', task)"
  >
    <header>
      <div class="card-title">
        <span class="task-title">{{ task.title }}</span>
        <span class="status-badge">{{ task.status }}</span>
      </div>
      <div class="card-meta">
        <small
          v-if="task.dueDate"
          class="due-date"
          :title="'Due: ' + task.dueDate"
        >
          <i class="bi bi-calendar" /> {{ task.dueDate }}
        </small>
        <small
          v-if="task.assignees && task.assignees.length"
          class="assignee-count"
        >
          <i class="bi bi-people" /> {{ task.assignees.length }}
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
  </article>
</template>

<script setup>
defineProps({
  task: { type: Object, required: true },
});

defineEmits(["click"]);
</script>

<style scoped>
.task-card {
  cursor: pointer;
  padding: var(--space-sm) var(--space-md);
  font-size: 0.9em;
  transition: transform 0.1s;
}

.task-card:hover {
  transform: translateY(-1px);
}

.task-card.is-done {
  opacity: 0.6;
}

.task-card header {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: 0;
  margin: 0;
  height: auto;
  background: none;
  border: none;
  border-radius: 0;
}

.card-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.task-title {
  font-weight: bold;
}

.status-badge {
  font-size: 0.75em;
  padding: 0.1em 0.4em;
  border-radius: var(--radius-sm);
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  white-space: nowrap;
}

.card-meta {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: 0.85em;
}

.due-date,
.assignee-count,
.checklist-progress {
  color: var(--pico-muted-color);
  display: flex;
  align-items: center;
  gap: 0.2em;
}

.task-card footer {
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
  font-size: 0.7em;
  padding: 0.1em 0.3em;
  border-radius: var(--radius-sm);
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
}

.priority-high {
  border-left: 3px solid var(--pico-del-color);
}

.priority-medium {
  border-left: 3px solid var(--pico-primary);
}

.priority-low {
  border-left: 3px solid var(--pico-muted-color);
}
</style>
