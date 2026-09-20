<template>
  <div class="item-card project-card" @click.stop="$emit('click', project)">
    <div class="card-accent" />
    <div class="card-body">
      <header>
        <div class="card-title-row">
          <span class="item-icon"><i class="bi bi-folder" /></span>
          <span class="item-title" :title="displayPath">{{ displayTitle }}</span>
        </div>
        <div class="badge-group">
          <span v-if="project.isDefault" class="badge">Default</span>
          <span v-if="project.archived" class="badge badge-archived">
            Archived</span
          >
          <span
            v-if="project.visibility === 'restricted'"
            class="badge badge-restricted"
          >
            <i class="bi bi-lock" />
          </span>
        </div>
      </header>
      <p v-if="project.description" class="card-desc">
        {{ project.description }}
      </p>
      <footer>
        <small class="status-count">
          <i class="bi bi-columns-gap" />
          {{ project.statuses?.length || 0 }} statuses
        </small>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { displayName, leafName } from "../utils/projectHierarchy";

const props = defineProps({
  project: { type: Object, required: true },
  depth: { type: Number, default: 0 },
});

defineEmits(["click"]);

const displayPath = computed(() => displayName(props.project.name));
// Inside the tree a sub-project shows its leaf name (the full path is in the
// surrounding indentation); at the root the full path is the label
const displayTitle = computed(() =>
  props.depth > 0 ? leafName(props.project.name) : displayPath.value,
);
</script>

<style scoped>
.badge-group {
  display: flex;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
  white-space: nowrap;
}

.badge-restricted {
  background: var(--color-danger);
  color: #fff;
}

.badge-archived {
  background: var(--color-text-muted);
  color: var(--color-surface, #fff);
}

.card-desc {
  margin-top: var(--space-xs);
  font-size: var(--text-base);
  color: var(--color-text-muted);
  line-height: var(--leading-normal);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.status-count {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
}
</style>
