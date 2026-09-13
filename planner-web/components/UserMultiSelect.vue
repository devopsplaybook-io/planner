<template>
  <div ref="rootEl" class="user-multi-select">
    <div class="ums-box" :class="{ 'is-disabled': disabled }" @click="onBoxClick">
      <span v-for="u in selectedUsers" :key="u.id" class="tag ums-chip">
        <i class="bi bi-person" />
        {{ u.name }}
        <button
          type="button"
          class="ums-remove"
          :disabled="disabled"
          :aria-label="`Remove ${u.name}`"
          @click.stop="remove(u.id)"
        >
          <i class="bi bi-x" />
        </button>
      </span>
      <input
        ref="inputEl"
        v-model="query"
        type="text"
        class="ums-input"
        role="combobox"
        :aria-expanded="open"
        aria-autocomplete="list"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="openDropdown"
        @keydown="onKeydown"
      >
    </div>
    <ul v-if="open" class="ums-dropdown">
      <li
        v-for="(u, i) in filtered"
        :key="u.id"
        class="ums-option"
        :class="{ 'is-highlighted': i === highlight }"
        @mousedown.prevent="select(u.id)"
        @mouseenter="highlight = i"
      >
        <i class="bi bi-person" />
        {{ u.name }}
      </li>
      <li v-if="!filtered.length" class="ums-empty">
        {{ users.length ? "No matching users" : "No users available" }}
      </li>
    </ul>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  users: { type: Array, default: () => [] },
  placeholder: { type: String, default: "Add users…" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const rootEl = ref(null);
const inputEl = ref(null);
const query = ref("");
const open = ref(false);
const highlight = ref(0);

const selectedUsers = computed(() =>
  props.modelValue
    .map((id) => props.users.find((u) => u.id === id))
    .filter(Boolean),
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.users.filter(
    (u) =>
      !props.modelValue.includes(u.id) &&
      (!q || u.name.toLowerCase().includes(q)),
  );
});

watch([query, () => props.users], () => {
  highlight.value = 0;
});

function openDropdown() {
  if (props.disabled) return;
  highlight.value = 0;
  open.value = true;
}

function onBoxClick() {
  if (props.disabled) return;
  inputEl.value?.focus();
  openDropdown();
}

function select(id) {
  if (props.modelValue.includes(id)) return;
  emit("update:modelValue", [...props.modelValue, id]);
  query.value = "";
  highlight.value = 0;
  nextTick(() => inputEl.value?.focus());
}

function remove(id) {
  emit(
    "update:modelValue",
    props.modelValue.filter((v) => v !== id),
  );
}

function onKeydown(e) {
  if (e.key === "Escape" && open.value) {
    e.preventDefault();
    e.stopPropagation();
    open.value = false;
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!open.value) {
      openDropdown();
      return;
    }
    if (filtered.value.length) {
      highlight.value = (highlight.value + 1) % filtered.value.length;
    }
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!open.value) {
      openDropdown();
      return;
    }
    if (filtered.value.length) {
      highlight.value =
        (highlight.value - 1 + filtered.value.length) % filtered.value.length;
    }
    return;
  }
  if (e.key === "Enter" && open.value) {
    e.preventDefault();
    const u = filtered.value[highlight.value];
    if (u) select(u.id);
    return;
  }
  if (e.key === "Backspace" && !query.value && props.modelValue.length) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}

function onDocMouseDown(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener("mousedown", onDocMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocMouseDown);
});
</script>

<style scoped>
.user-multi-select {
  position: relative;
}

.ums-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2xs);
  padding: calc(var(--space-2xs) + 1px) var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: text;
}

.ums-box:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.ums-box.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ums-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.ums-remove {
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: inherit;
  cursor: pointer;
  font-size: var(--text-md);
  line-height: 1;
  opacity: 0.7;
}

.ums-remove:hover {
  opacity: 1;
  color: var(--color-danger);
}

.ums-input {
  flex: 1;
  min-width: 8em;
  border: none;
  background: transparent;
  padding: var(--space-2xs) 0;
  margin: 0;
  box-shadow: none;
  outline: none;
  height: auto;
}

.ums-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  margin: 2px 0 0;
  padding: var(--space-2xs);
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  max-height: 200px;
  overflow-y: auto;
}

.ums-option {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-base);
}

.ums-option.is-highlighted {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}

.ums-empty {
  padding: var(--space-xs) var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--text-base);
  cursor: default;
}
</style>
