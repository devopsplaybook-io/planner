<template>
  <div
    class="tree-branch"
    :class="{ 'has-children': node.children.length > 0 }"
  >
    <div class="project-slot">
      <i
        v-if="node.orphan"
        class="bi bi-exclamation-triangle orphan-warning"
        title="Parent project not found"
      />
      <ProjectCard
        :project="node.project"
        :depth="node.depth"
        @click="emit('open', node.project.id)"
      />
    </div>
    <div
      v-if="node.children.length"
      class="child-group"
    >
      <ProjectTreeBranch
        v-for="child in node.children"
        :key="child.project.id"
        :node="child"
        @open="emit('open', $event)"
      />
    </div>
  </div>
</template>

<script setup>
defineProps({
  node: { type: Object, required: true },
});

const emit = defineEmits(["open"]);
</script>

<style scoped>
.tree-branch {
  display: grid;
  gap: var(--space-md);
}

/* A parent and its nested child group take a full-width row so the children
   render directly below their parent instead of flowing into other columns */
.tree-branch.has-children {
  grid-column: 1 / -1;
}

.project-slot {
  position: relative;
  /* Inside a full-width row the parent card keeps a regular cell width */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
}

/* One indent step per hierarchy level, with a connecting border */
.child-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
  margin-left: 1.25rem;
  padding-left: var(--space-md);
  border-left: 2px solid var(--color-border);
}

.orphan-warning {
  position: absolute;
  top: -0.6em;
  right: 0.5em;
  z-index: 1;
  color: var(--color-warning, #b58900);
}
</style>
