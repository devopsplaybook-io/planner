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
    <div v-if="isMonthly" class="recurrence-monthday">
      <span class="recurrence-monthday-label">On day</span>
      <input
        v-model.number="monthDayInput"
        type="number"
        min="1"
        max="31"
        step="1"
        aria-label="Day of month"
        @change="onMonthDayChange"
      >
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
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  modelValue: { type: Object, default: null },
  defaultMonthDay: { type: Number, default: null },
});
const emit = defineEmits(["update:modelValue"]);

// Presets carry interval 1; anything else (interval > 1, or a different
// unit) is "custom". A weekly preset stays selected when weekday chips are
// toggled, so the select does not jump to Custom… on the first chip click.
const mode = ref("none");
const customInterval = ref(1);
const customUnit = ref("daily");
const monthDayInput = ref(1);

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

function clampInterval(value) {
  return Math.min(999, Math.max(1, Math.round(Number(value) || 1)));
}

function clampMonthDay(value) {
  return Math.min(31, Math.max(1, Math.round(Number(value) || 1)));
}

// Day shown when a monthly rule carries no explicit monthDay: the prop
// seed (the due date's day) or today's day of month as a last fallback.
function monthDaySeed() {
  if (props.defaultMonthDay >= 1 && props.defaultMonthDay <= 31) {
    return Math.round(props.defaultMonthDay);
  }
  return new Date().getDate();
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
      if (rule.frequency === "monthly") {
        monthDayInput.value = rule.monthDay ?? monthDaySeed();
      }
    }
    if (rule !== lastEmitted.value) {
      mode.value = modeForRule(rule);
    }
  },
  { immediate: true },
);

// Keep the displayed day in sync with the seed (the due date's day) for
// monthly rules without an explicit monthDay, e.g. when the user picks
// monthly first and fills the due date afterwards. An explicit monthDay
// is never overridden.
watch(
  () => props.defaultMonthDay,
  () => {
    const rule = props.modelValue;
    if (rule && rule.frequency === "monthly" && !rule.monthDay) {
      monthDayInput.value = monthDaySeed();
    }
  },
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

function onCustomChange() {
  emitCustomRule(
    customUnit.value,
    clampInterval(customInterval.value),
    props.modelValue,
  );
}

function onMonthDayChange() {
  const source = props.modelValue;
  if (!source || source.frequency !== "monthly") return;
  const day = clampMonthDay(monthDayInput.value);
  monthDayInput.value = day;
  const rule = { ...source, monthDay: day };
  lastEmitted.value = rule;
  emit("update:modelValue", rule);
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
  grid-template-columns: auto 6rem;
  gap: var(--space-2xs);
  align-items: center;
}

.recurrence-monthday-label {
  font-size: var(--text-md);
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
}

.recurrence-weekday.is-on {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-color: var(--color-primary);
}
</style>
