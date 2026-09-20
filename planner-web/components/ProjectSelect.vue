<template>
  <div ref="rootEl" class="project-select">
    <button
      type="button"
      class="project-select-trigger"
      :title="selectedPath || allLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleOpen"
      @keydown="onTriggerKeydown"
    >
      <i class="bi bi-folder2" />
      <span class="trigger-label">{{ selectedLabel }}</span>
      <i
        class="bi bi-chevron-down trigger-chevron"
        :class="{ open: open }"
      />
    </button>

    <div
      v-if="open"
      class="project-select-popover"
      :style="popoverStyle"
      @click.stop
      @keydown="onPopoverKeydown"
    >
      <div class="tree-search">
        <i class="bi bi-search" />
        <input
          ref="searchEl"
          v-model="search"
          type="search"
          placeholder="Search projects…"
          aria-label="Search projects"
        >
      </div>
      <div
        class="tree-options"
        role="listbox"
        aria-label="Projects"
        :aria-activedescendant="activeOptionId"
      >
        <div
          v-if="allLabel"
          :id="`${uid}-opt-all`"
          class="tree-item"
          role="option"
          :aria-selected="modelValue === ''"
          :class="{ active: activeIndex === 0 }"
          @click="select('')"
          @mousemove="activeIndex = 0"
        >
          <span class="tree-label">{{ allLabel }}</span>
        </div>
        <div
          v-for="(node, index) in flatVisibleNodes"
          :id="`${uid}-opt-${node.project.id}`"
          :key="node.project.id"
          class="tree-item"
          role="option"
          :aria-selected="node.project.id === modelValue"
          :class="{
            active: activeIndex === listIndex(index),
            selected: node.project.id === modelValue,
          }"
          :style="{ '--depth': node.depth }"
          :title="node.project.name"
          @click="select(node.project.id)"
          @mousemove="activeIndex = listIndex(index)"
        >
          <button
            v-if="node.children.length"
            type="button"
            class="tree-toggle"
            :aria-label="isExpanded(node.project.id) ? 'Collapse' : 'Expand'"
            @click.stop="toggleExpand(node.project.id)"
          >
            <i
              class="bi"
              :class="
                isExpanded(node.project.id)
                  ? 'bi-chevron-down'
                  : 'bi-chevron-right'
              "
            />
          </button>
          <span v-else class="tree-toggle tree-toggle-spacer" />
          <i
            class="bi tree-icon"
            :class="node.project.archived ? 'bi-archive' : 'bi-folder'"
          />
          <span class="tree-label">{{ leafLabel(node.project.name) }}</span>
          <span v-if="node.project.archived" class="tree-archived">
            (archived)</span
          >
          <i
            v-if="node.orphan"
            class="bi bi-exclamation-triangle tree-orphan"
            title="Parent project not found"
          />
          <span
            v-if="node.depth > 0"
            class="tree-path"
          >{{ displayPath(node.project.name) }}</span>
        </div>
        <div v-if="flatVisibleNodes.length === 0" class="tree-empty">
          No projects found
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  buildProjectTree,
  displayName,
  leafName,
} from "../utils/projectHierarchy";

const props = defineProps({
  modelValue: { type: String, default: "" },
  allLabel: { type: String, default: "" },
  includeArchived: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const projectsStore = useProjectsStore();

const uid = `ps${Math.random().toString(36).slice(2, 8)}`;
const rootEl = ref(null);
const searchEl = ref(null);
const open = ref(false);
const search = ref("");
const activeIndex = ref(0);
// Users may collapse nodes; everything starts expanded so the nesting is
// visible right away
const collapsed = ref(new Set());

// Active projects only, unless the consumer opts in (history). A persisted
// filter pointing at an archived project stays selectable so the select
// never shows an empty value; the API returns archived projects last.
const options = computed(() => {
  const projects = projectsStore.projects;
  if (props.includeArchived) {
    return projects;
  }
  return projects.filter((p) => !p.archived || p.id === props.modelValue);
});

const tree = computed(() => buildProjectTree(options.value));

// A node matches when any segment of its path contains the search term;
// matches keep their ancestors so the tree context stays readable
const visibleTree = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) {
    return tree.value;
  }
  const matches = (name) =>
    name
      .split("/")
      .some((segment) =>
        segment.trim().toLowerCase().includes(term),
      );

  const filterNodes = (nodes) =>
    nodes
      .map((node) => {
        const children = filterNodes(node.children);
        if (matches(node.project.name) || children.length > 0) {
          return { ...node, children };
        }
        return null;
      })
      .filter(Boolean);
  return filterNodes(tree.value);
});

const flatVisibleNodes = computed(() => {
  // While searching every level is expanded; otherwise respect collapsed
  const expandAll = search.value.trim() !== "";
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children.length && (expandAll || isExpanded(node.project.id))) {
        walk(node.children);
      }
    }
  };
  walk(visibleTree.value);
  return out;
});

// "All projects" occupies list index 0 when present
function listIndex(treeIndex) {
  return treeIndex + (props.allLabel ? 1 : 0);
}

function isExpanded(projectId) {
  return !collapsed.value.has(projectId);
}

function toggleExpand(projectId) {
  const next = new Set(collapsed.value);
  if (next.has(projectId)) {
    next.delete(projectId);
  } else {
    next.add(projectId);
  }
  collapsed.value = next;
}

const selectedProject = computed(() =>
  projectsStore.projects.find((p) => p.id === props.modelValue),
);

const selectedLabel = computed(() => {
  if (!props.modelValue) {
    return props.allLabel || "";
  }
  return selectedProject.value ? displayName(selectedProject.value.name) : "";
});

const selectedPath = computed(() =>
  selectedProject.value ? displayName(selectedProject.value.name) : "",
);

function leafLabel(name) {
  return leafName(name);
}

function displayPath(name) {
  return displayName(name);
}

function toggleOpen() {
  if (open.value) {
    close();
  } else {
    openPopover();
  }
}

function openPopover() {
  open.value = true;
  activeIndex.value = 0;
  nextTick(() => {
    searchEl.value?.focus();
    positionPopover();
    scrollActiveIntoView();
  });
  document.addEventListener("click", onDocumentClick);
  window.addEventListener("resize", positionPopover);
  window.addEventListener("scroll", positionPopover, true);
}

function close() {
  open.value = false;
  search.value = "";
  document.removeEventListener("click", onDocumentClick);
  window.removeEventListener("resize", positionPopover);
  window.removeEventListener("scroll", positionPopover, true);
}

// The popover is fixed-positioned so page scroll containers cannot clip it;
// it anchors to the trigger and flips to the left edge near the viewport's
// right side
const popoverStyle = ref({});

function positionPopover() {
  const trigger = rootEl.value?.querySelector(".project-select-trigger");
  if (!open.value || !trigger) {
    return;
  }
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(
    Math.max(rect.width, 300),
    400,
    window.innerWidth - margin * 2,
  );
  let left = rect.left;
  if (left + width > window.innerWidth - margin) {
    // Near the viewport's right edge, align the popover's right edge with the
    // trigger's instead of overhanging it
    left = rect.right - width;
  }
  if (left < margin) {
    left = Math.min(margin, window.innerWidth - width - margin);
  }
  popoverStyle.value = {
    position: "fixed",
    top: `${rect.bottom + 4}px`,
    left: `${left}px`,
    width: `${width}px`,
  };
}

function onDocumentClick(event) {
  if (rootEl.value && !rootEl.value.contains(event.target)) {
    close();
  }
}

function select(projectId) {
  emit("update:modelValue", projectId);
  close();
}

const activeOptionId = computed(() => {
  if (props.allLabel && activeIndex.value === 0) {
    return `${uid}-opt-all`;
  }
  const node =
    flatVisibleNodes.value[activeIndex.value - (props.allLabel ? 1 : 0)];
  return node ? `${uid}-opt-${node.project.id}` : undefined;
});

function scrollActiveIntoView() {
  nextTick(() => {
    document
      .getElementById(activeOptionId.value)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function onTriggerKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openPopover();
  }
}

function onPopoverKeydown(event) {
  const count = flatVisibleNodes.value.length + (props.allLabel ? 1 : 0);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (count > 0) {
      activeIndex.value = Math.min(activeIndex.value + 1, count - 1);
      scrollActiveIntoView();
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (count > 0) {
      activeIndex.value = Math.max(activeIndex.value - 1, 0);
      scrollActiveIntoView();
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (props.allLabel && activeIndex.value === 0) {
      select("");
      return;
    }
    const node = flatVisibleNodes.value[activeIndex.value - (props.allLabel ? 1 : 0)];
    if (node) {
      select(node.project.id);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
    rootEl.value?.querySelector(".project-select-trigger")?.focus();
  }
}

onBeforeUnmount(() => {
  close();
});
</script>

<style scoped>
.project-select {
  position: relative;
  min-width: 10rem;
}

.project-select-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  width: 100%;
  padding: 0.45em 0.6em;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--text-md);
  cursor: pointer;
  max-width: 16rem;
}

.project-select-trigger:hover {
  border-color: var(--color-primary);
}

.project-select-trigger .trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trigger-chevron {
  margin-left: auto;
  transition: transform 0.15s ease;
  font-size: var(--text-sm);
}

.trigger-chevron.open {
  transform: rotate(180deg);
}

.project-select-popover {
  z-index: 60;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: var(--space-2xs);
}

.tree-search {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0 0.4em;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-2xs);
}

.tree-search > i {
  opacity: 0.55;
}

.tree-search input {
  width: 100%;
  padding: 0.4em 0;
  border: none;
  background: transparent;
  font-size: var(--text-md);
  color: var(--color-text);
}

.tree-search input:focus {
  outline: none;
  /* Pico paints its focus ring with a box-shadow, which reads as a border
     around this borderless input */
  box-shadow: none;
}

.tree-options {
  max-height: 320px;
  overflow-y: auto;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  width: 100%;
  padding: 0.35em 0.5em 0.35em calc(0.5em + var(--depth, 0) * 1rem);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
}

.tree-item.active {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.tree-item.selected {
  background: color-mix(in srgb, var(--color-primary) 20%, transparent);
  font-weight: var(--weight-medium);
}

/* The indent lives on the item's padding, so the toggle must not shift it */
.tree-toggle {
  flex-shrink: 0;
  width: 1.2rem;
  height: 1.4rem;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
}

.tree-toggle:hover {
  color: var(--color-primary);
}

.tree-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-archived {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.tree-orphan {
  flex-shrink: 0;
  color: var(--color-warning, #b58900);
}

.tree-path {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  max-width: 45%;
}

.tree-empty {
  padding: var(--space-sm);
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
</style>
