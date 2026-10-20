<template>
  <div ref="rootEl" class="label-multi-select">
    <div class="lms-box" :class="{ 'is-disabled': disabled }" @click="onBoxClick">
      <span v-for="l in modelValue" :key="l" class="tag lms-chip">
        <i class="bi bi-tag" />
        {{ l }}
        <button
          type="button"
          class="lms-remove"
          :disabled="disabled"
          :aria-label="`Remove ${l}`"
          @click.stop="remove(l)"
        >
          <i class="bi bi-x" />
        </button>
      </span>
      <input
        ref="inputEl"
        v-model="query"
        type="text"
        class="lms-input"
        role="combobox"
        :aria-expanded="open"
        aria-autocomplete="list"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="openDropdown"
        @keydown="onKeydown"
      >
    </div>
    <ul v-if="open" class="lms-dropdown">
      <li
        v-for="(s, i) in filtered"
        :key="s.name"
        class="lms-option"
        :class="{ 'is-highlighted': i === highlight }"
        @mousedown.prevent="select(s.name)"
        @mouseenter="highlight = i"
      >
        <i class="bi bi-tag" />
        {{ s.name }}
        <small v-if="s.count" class="lms-count">{{ s.count }}</small>
      </li>
      <li v-if="typedName && !filtered.length" class="lms-empty">
        Press Enter to add "{{ typedName }}"
      </li>
      <li v-else-if="!filtered.length" class="lms-empty">
        No matching labels
      </li>
    </ul>
  </div>
</template>

<script setup>
// Chip editor for free-form labels with autocomplete from existing labels
// (modeled on UserMultiSelect): labels are plain strings, so typing a new
// name and pressing Enter adds it.
// Explicit imports so the component also mounts under plain vitest
// (without Nuxt's auto-imports) — see LabelMultiSelect.spec.ts
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  suggestions: { type: Array, default: () => [] },
  // Suggestions starting with one of these prefixes are hidden from the
  // dropdown (machine-managed labels in the human editors); typed free-form
  // entry is unaffected
  excludePrefixes: { type: Array, default: () => [] },
  placeholder: { type: String, default: "Add labels…" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const rootEl = ref(null);
const inputEl = ref(null);
const query = ref("");
const open = ref(false);
const highlight = ref(0);

const typedName = computed(() => query.value.trim());

const filtered = computed(() => {
  const q = typedName.value.toLowerCase();
  return props.suggestions.filter(
    (s) =>
      s?.name &&
      !props.modelValue.includes(s.name) &&
      !props.excludePrefixes.some((prefix) => s.name.startsWith(prefix)) &&
      (!q || s.name.toLowerCase().includes(q)),
  );
});

watch([query, () => props.suggestions], () => {
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

function add(name) {
  const trimmed = name.trim();
  if (!trimmed || props.modelValue.includes(trimmed)) return;
  emit("update:modelValue", [...props.modelValue, trimmed]);
  query.value = "";
  highlight.value = 0;
  nextTick(() => inputEl.value?.focus());
}

function select(name) {
  add(name);
}

function remove(name) {
  emit(
    "update:modelValue",
    props.modelValue.filter((v) => v !== name),
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
  // Enter adds the highlighted suggestion, or the typed label itself when
  // no suggestion matches (free-form entry)
  if (e.key === "Enter" && open.value) {
    e.preventDefault();
    const suggestion = filtered.value[highlight.value];
    if (suggestion) {
      select(suggestion.name);
    } else {
      add(typedName.value);
    }
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
.label-multi-select {
  position: relative;
}

.lms-box {
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

.lms-box:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.lms-box.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.lms-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.lms-remove {
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

.lms-remove:hover {
  opacity: 1;
  color: var(--color-danger);
}

.lms-input {
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

/* Overflows this component's box by design — ancestors (up to the dialog)
   must not clip it: see the overflow overrides in TaskDetailDialog.vue and
   ProjectDetailDialog.vue that cancel the `dialog article section` rule */
.lms-dropdown {
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

.lms-option {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-base);
}

.lms-option.is-highlighted {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}

.lms-count {
  margin-left: auto;
  color: var(--color-text-muted);
}

.lms-empty {
  padding: var(--space-xs) var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--text-base);
  cursor: default;
}
</style>
