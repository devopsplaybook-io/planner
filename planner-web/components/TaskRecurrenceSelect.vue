<template>
  <div class="recurrence-select">
    <select v-model="mode" aria-label="Repeats" @change="onModeChange">
      <option value="none">Does not repeat</option>
      <option value="daily">Every day</option>
      <option value="weekly">Every week</option>
      <option value="monthly">Every month</option>
      <option value="custom">Custom…</option>
    </select>
    <div v-if="mode === 'custom'" class="recurrence-custom">
      <input
        v-model.number="customInterval"
        type="number"
        min="1"
        max="999"
        step="1"
        aria-label="Repeat every"
        @change="onCustomChange"
      >
      <select
        v-model="customUnit"
        aria-label="Repeat unit"
        @change="onCustomChange"
      >
        <option value="daily">days</option>
        <option value="weekly">weeks</option>
        <option value="monthly">months</option>
      </select>
    </div>
    <div v-if="isWeekly" class="recurrence-weekdays" role="group" aria-label="Repeat on">
      <button
        v-for="day in weekdays"
        :key="day.value"
        type="button"
        class="recurrence-weekday"
        :class="{ 'is-on': isWeekdayOn(day.value) }"
        :aria-pressed="isWeekdayOn(day.value)"
        @click="toggleWeekday(day.value)"
      >
        {{ day.label }}
      </button>
    </div>
    <div v-if="isMonthly" class="recurrence-monthday">
      <select v-model="monthDay" aria-label="Day of month" @change="onMonthDayChange">
        <option value="">Same day as the due date</option>
        <option v-for="d in 30" :key="d" :value="d">{{ ordinalDay(d) }}</option>
        <option :value="31">Last day</option>
      </select>
      <template v-if="showAlign">
        <small class="text-muted">
          The due date drives the first occurrence; this rule repeats on
          {{ alignHintDay }}.
        </small>
        <button type="button" class="recurrence-align" @click="onAlign">
          Align due date
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { ordinalDay, alignDueDateToMonthDay } from "../utils/recurrence";

const props = defineProps({
  modelValue: { type: Object, default: null },
  dueDate: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue", "align"]);

// Presets carry interval 1; anything else (interval > 1, or a different
// unit) is "custom". A weekly preset stays selected when weekday chips are
// toggled, so the select does not jump to Custom… on the first chip click.
const mode = ref("none");
const customInterval = ref(1);
const customUnit = ref("daily");
const monthDay = ref("");

const weekdays = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const isWeekly = computed(() => props.modelValue?.frequency === "weekly");
const isMonthly = computed(() => props.modelValue?.frequency === "monthly");

const alignedDate = computed(() =>
  isMonthly.value && props.dueDate && props.modelValue?.monthDay
    ? alignDueDateToMonthDay(props.dueDate, props.modelValue.monthDay)
    : null,
);
const showAlign = computed(
  () => !!alignedDate.value && alignedDate.value !== props.dueDate,
);
const alignHintDay = computed(() =>
  props.modelValue.monthDay >= 31
    ? "the last day"
    : `the ${ordinalDay(props.modelValue.monthDay)}`,
);

function clampInterval(value) {
  return Math.min(999, Math.max(1, Math.round(Number(value) || 1)));
}

function modeForRule(rule) {
  if (!rule || !rule.frequency) return "none";
  if (rule.interval === 1) return rule.frequency;
  return "custom";
}

const lastEmitted = ref(null);
watch(
  () => props.modelValue,
  (rule) => {
    if (rule && rule.frequency) {
      customInterval.value = rule.interval;
      customUnit.value = rule.frequency;
    }
    monthDay.value = rule?.monthDay ?? "";
    if (rule !== lastEmitted.value) {
      mode.value = modeForRule(rule);
    }
  },
  { immediate: true },
);

function emitCustomRule(frequency, interval, source) {
  const rule = { frequency, interval };
  if (
    frequency === "weekly" &&
    Array.isArray(source?.weekdays) &&
    source.weekdays.length > 0
  ) {
    rule.weekdays = [...source.weekdays];
  }
  if (frequency === "monthly" && source?.monthDay) {
    rule.monthDay = source.monthDay;
  }
  lastEmitted.value = rule;
  emit("update:modelValue", rule);
}

function onModeChange() {
  if (mode.value === "none") {
    emit("update:modelValue", null);
    return;
  }
  if (mode.value === "custom") {
    const source = props.modelValue;
    const frequency = source?.frequency || "daily";
    const interval = source?.interval > 1 ? source.interval : 1;
    customInterval.value = interval;
    customUnit.value = frequency;
    emitCustomRule(frequency, interval, source);
    return;
  }
  const rule = { frequency: mode.value, interval: 1 };
  if (
    mode.value === "weekly" &&
    Array.isArray(props.modelValue?.weekdays) &&
    props.modelValue.weekdays.length > 0
  ) {
    rule.weekdays = [...props.modelValue.weekdays];
  }
  if (mode.value === "monthly" && props.modelValue?.monthDay) {
    rule.monthDay = props.modelValue.monthDay;
  }
  lastEmitted.value = rule;
  emit("update:modelValue", rule);
}

function onMonthDayChange() {
  const source = props.modelValue;
  if (!source || source.frequency !== "monthly") {
    return;
  }
  const rule = { ...source };
  if (monthDay.value === "") {
    delete rule.monthDay;
  } else {
    rule.monthDay = monthDay.value;
  }
  lastEmitted.value = rule;
  emit("update:modelValue", rule);
}

function onAlign() {
  if (alignedDate.value) {
    emit("align", alignedDate.value);
  }
}

function onCustomChange() {
  emitCustomRule(
    customUnit.value,
    clampInterval(customInterval.value),
    props.modelValue,
  );
}

function isWeekdayOn(day) {
  return (
    Array.isArray(props.modelValue?.weekdays) &&
    props.modelValue.weekdays.includes(day)
  );
}

function toggleWeekday(day) {
  const source = props.modelValue;
  const rule =
    source && source.frequency === "weekly"
      ? { ...source }
      : {
          frequency: "weekly",
          interval:
            mode.value === "custom" ? clampInterval(customInterval.value) : 1,
        };
  const current = Array.isArray(rule.weekdays) ? [...rule.weekdays] : [];
  const index = current.indexOf(day);
  if (index >= 0) {
    current.splice(index, 1);
  } else {
    current.push(day);
  }
  if (current.length > 0) {
    rule.weekdays = current;
  } else {
    delete rule.weekdays;
  }
  lastEmitted.value = rule;
  emit("update:modelValue", rule);
}
</script>

<style scoped>
.recurrence-select {
  display: grid;
  gap: var(--space-2xs);
}

.recurrence-select select,
.recurrence-select input {
  margin: 0;
}

.recurrence-custom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2xs);
}

.recurrence-monthday {
  display: grid;
  gap: var(--space-2xs);
}

.recurrence-align {
  margin: 0;
  padding: 0.2em 0;
  font-size: var(--text-xs);
  line-height: 1.4;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.recurrence-align:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
}

.recurrence-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--space-2xs);
}

.recurrence-weekday {
  margin: 0;
  padding: 0.2em 0;
  font-size: var(--text-xs);
  line-height: 1.4;
  border-radius: var(--radius-sm);
  /* Quiet off state (like button.secondary): the global button style fills
     every button with the primary colors, which made on and off identical */
  background: var(--color-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.recurrence-weekday:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
}

.recurrence-weekday.is-on,
.recurrence-weekday.is-on:hover {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-color: var(--color-primary);
}
</style>
