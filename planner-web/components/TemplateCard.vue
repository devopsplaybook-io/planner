<template>
  <div
    class="item-card template-card"
    :class="`priority-${template.priority}`"
    @click.stop="$emit('click', template)"
  >
    <div class="card-accent" />
    <div class="card-body">
      <header>
        <div class="card-title-row">
          <span class="item-icon"><i class="bi bi-arrow-repeat" /></span>
          <span class="item-title">{{ template.title }}</span>
        </div>
      </header>
      <div class="card-status-row">
        <span
          class="automation-chip"
          :title="template.automation?.scheduleCron || ''"
          >{{ automationLabel }}</span
        >
        <span
          v-if="template.automation?.instanceStatus"
          class="initial-status-chip"
          :title="'Instances start in ' + template.automation.instanceStatus"
          ><i class="bi bi-flag" /> {{ template.automation.instanceStatus }}</span
        >
      </div>
      <div class="card-meta">
        <small
          v-if="template.checklist && template.checklist.length"
          class="checklist-progress"
        >
          <i class="bi bi-list-check" />
          {{ template.checklist.filter((c) => c.done).length }}/{{
            template.checklist.length
          }}
        </small>
        <small
          v-if="template.assignees && template.assignees.length"
          class="assignee-count"
        >
          <i class="bi bi-people-fill" /> {{ template.assignees.length }}
        </small>
        <small
          v-if="template.attachments && template.attachments.length"
          class="attachment-count"
        >
          <i class="bi bi-paperclip" /> {{ template.attachments.length }}
        </small>
        <small
          v-if="template.comments && template.comments.length"
          class="comment-count"
        >
          <i class="bi bi-chat-left-text" /> {{ template.comments.length }}
        </small>
        <small v-if="template.automation?.skipIfPreviousNotDone" class="skip-flag">
          <i class="bi bi-skip-forward" /> skips open
        </small>
      </div>
      <footer v-if="template.labels && template.labels.length">
        <span v-for="l in template.labels" :key="l" class="label-tag">{{ l }}</span>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { cronLabel } from "../utils/taskTemplate";

const props = defineProps({
  template: { type: Object, required: true },
});

defineEmits(["click"]);

const automationLabel = computed(
  () => cronLabel(props.template.automation?.scheduleCron) || "Manual",
);
</script>

<style scoped>
/* Left accent stripe colored by priority, like the task cards */
.priority-high .card-accent {
  background: var(--color-danger);
}
.priority-medium .card-accent {
  background: var(--color-primary);
}
.priority-low .card-accent {
  background: var(--color-text-muted);
}

/* Chip row on its own line under the title; chips truncate with an ellipsis
   when they don't fit together (full text on hover via title) */
.card-status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
}

/* Automation chip in place of the task status badge: a muted uppercase pill */
.automation-chip {
  flex-shrink: 0;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
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

/* Initial status chip: same pill shape as the automation chip but an
   outlined treatment so the row keeps its hierarchy (automation first) */
.initial-status-chip {
  flex-shrink: 0;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-text-muted);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.initial-status-chip i {
  font-size: 0.85em;
}

.card-meta {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.checklist-progress,
.assignee-count,
.attachment-count,
.comment-count,
.skip-flag {
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
