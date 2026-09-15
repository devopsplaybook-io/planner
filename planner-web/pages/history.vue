<template>
  <div class="history-page">
    <header class="page-header">
      <hgroup>
        <h1>History</h1>
        <p>Task timeline over time</p>
      </hgroup>
      <div class="header-controls">
        <select
          :value="projectsStore.selectedProjectFilter"
          @change="onFilterChange"
        >
          <option value="">All projects</option>
          <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <section v-if="topAssignees.length > 0" class="assignees-section">
        <h2><i class="bi bi-people" /> Top assignees</h2>
        <div class="assignee-chips">
          <span
            v-for="a in topAssignees"
            :key="a.name"
            class="assignee-chip"
            :title="`${a.count} task${a.count > 1 ? 's' : ''}`"
          >
            <i class="bi bi-person-fill" /> {{ a.name }}
            <span class="assignee-count">{{ a.count }}</span>
          </span>
        </div>
      </section>

      <div v-if="rows.length === 0" class="empty-state">
        <i class="bi bi-clock-history" />
        <p>No tasks to display yet.</p>
      </div>

      <div v-else class="timeline">
        <!-- Wrapper carries the span-driven min-width so axis, rows and the
             absolute grid overlay all share one track width -->
        <div class="timeline-inner" :style="{ '--months': monthCount }">
          <div class="timeline-axis">
            <div class="axis-label" />
            <div class="axis-track">
              <span
                v-for="tick in ticks"
                :key="tick.time"
                class="axis-tick"
                :style="{ left: tick.pct + '%' }"
              >
                {{ tick.label }}
              </span>
              <span
                v-if="nowPct !== null"
                class="axis-now"
                :style="{ left: nowPct + '%' }"
              >
                now
              </span>
            </div>
          </div>

          <div class="timeline-rows">
            <div class="grid-overlay">
              <span
                v-for="tick in ticks"
                :key="tick.time"
                class="grid-line"
                :style="{ left: tick.pct + '%' }"
              />
              <span
                v-if="nowPct !== null"
                class="now-line"
                :style="{ left: nowPct + '%' }"
              />
            </div>

            <div v-for="row in rows" :key="row.task.id" class="timeline-row">
              <div class="row-label">
                <button class="row-title" @click="openTask(row.task)">
                  {{ row.task.title }}
                </button>
                <span
                  v-if="assigneeNames(row.task)"
                  class="row-assignees"
                  :title="assigneeNames(row.task)"
                >
                  <i class="bi bi-people" />
                  <span class="assignee-text">
                    {{ assigneeNames(row.task) }}
                  </span>
                </span>
              </div>
              <div class="row-track">
                <button
                  class="task-bar"
                  :class="{ ongoing: !row.isDone }"
                  :style="barStyle(row)"
                  :title="barTitle(row)"
                  @click="openTask(row.task)"
                >
                  <span class="bar-text">{{ barText(row) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { readableTextColor } from "../utils/statusColor";

const TOP_ASSIGNEES = 10;

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const now = ref(Date.now());

// All visible tasks are fetched once; the project filter is applied
// client-side so switching projects never triggers a refetch
const filteredTasks = computed(() => {
  const projectId = projectsStore.selectedProjectFilter;
  if (!projectId) return tasksStore.tasks;
  return tasksStore.tasks.filter((t) => t.projectId === projectId);
});

// Shared time domain: earliest task creation to latest bar end
// (Done tasks end at their last update; open tasks extend to now)
const domain = computed(() => {
  let start = Infinity;
  let end = -Infinity;
  for (const t of filteredTasks.value) {
    const created = new Date(t.dateCreated).getTime();
    const updated = new Date(t.dateUpdated || t.dateCreated).getTime();
    if (Number.isFinite(created) && created < start) {
      start = created;
    }
    const barEnd = t.status === "Done" ? Math.max(updated, created) : now.value;
    if (barEnd > end) {
      end = barEnd;
    }
  }
  if (!Number.isFinite(start)) {
    start = now.value - 30 * 24 * 60 * 60 * 1000;
    end = now.value;
  }
  if (end - start < 24 * 60 * 60 * 1000) {
    end = start + 24 * 60 * 60 * 1000;
  }
  return { start, end, span: end - start };
});

const rows = computed(() => {
  const { start, span } = domain.value;
  return filteredTasks.value
    .map((t) => {
      const created = new Date(t.dateCreated).getTime();
      const updated = new Date(t.dateUpdated || t.dateCreated).getTime();
      const isDone = t.status === "Done";
      const barEnd = isDone ? Math.max(updated, created) : now.value;
      return {
        task: t,
        isDone,
        leftPct: ((created - start) / span) * 100,
        widthPct: ((barEnd - created) / span) * 100,
      };
    })
    .sort(
      (a, b) => new Date(a.task.dateCreated) - new Date(b.task.dateCreated),
    );
});

// Month gridlines (year gridlines when the domain spans several years)
const ticks = computed(() => {
  const { start, end, span } = domain.value;
  const out = [{ time: start, label: shortMonthYear(start) }];
  const spanDays = span / (24 * 60 * 60 * 1000);
  if (spanDays > 730) {
    for (let year = new Date(start).getFullYear() + 1; ; year++) {
      const time = new Date(year, 0, 1).getTime();
      if (time > end) break;
      out.push({ time, label: String(year) });
    }
  } else {
    const month = new Date(start);
    month.setDate(1);
    month.setHours(0, 0, 0, 0);
    month.setMonth(month.getMonth() + 1);
    for (;;) {
      const time = month.getTime();
      if (time > end) break;
      out.push({ time, label: shortMonthYear(time) });
      month.setMonth(month.getMonth() + 1);
    }
  }
  return out.map((tick) => ({
    ...tick,
    pct: ((tick.time - start) / span) * 100,
  }));
});

// Months covered by the domain: drives the Gantt min-width so every month
// gets at least --min-month-w of horizontal track
const monthCount = computed(() => {
  const { start, end } = domain.value;
  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  let count = 0;
  for (;;) {
    const time = cursor.getTime();
    if (time > end) break;
    count++;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return Math.max(count, 1);
});

const nowPct = computed(() => {
  const { start, span } = domain.value;
  const pct = ((now.value - start) / span) * 100;
  return pct >= 0 && pct <= 100 ? pct : null;
});

const topAssignees = computed(() => {
  const counts = new Map();
  for (const t of filteredTasks.value) {
    for (const a of t.assignees || []) {
      const name = a.userName || a.userId;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_ASSIGNEES);
});

function shortMonthYear(time) {
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function shortDate(time) {
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function longDate(time) {
  return new Date(time).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function barText(row) {
  const created = new Date(row.task.dateCreated).getTime();
  const end = row.isDone
    ? shortDate(new Date(row.task.dateUpdated || row.task.dateCreated).getTime())
    : "now";
  return `${shortDate(created)} → ${end}`;
}

function barTitle(row) {
  const created = new Date(row.task.dateCreated).getTime();
  const end = row.isDone
    ? `Done ${longDate(
        new Date(row.task.dateUpdated || row.task.dateCreated).getTime(),
      )}`
    : "ongoing";
  return `${row.task.status} · created ${longDate(created)} — ${end}`;
}

function barStyle(row) {
  const color = statusesStore.colorFor(row.task.status);
  return {
    left: row.leftPct + "%",
    width: row.widthPct + "%",
    background: color,
    color: readableTextColor(color),
  };
}

function assigneeNames(task) {
  return (task.assignees || [])
    .map((a) => a.userName || a.userId)
    .join(", ");
}

function onFilterChange(event) {
  projectsStore.setProjectFilter(event.target.value);
}

function openTask(task) {
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

async function fetchHistory() {
  loading.value = true;
  try {
    // No projectId / doneSince: all visible tasks including all-time Done
    // (visibility is enforced server-side); everything else is client-side
    await tasksStore.fetchAll();
    now.value = Date.now();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    await Promise.all([projectsStore.fetchAll(), statusesStore.fetchAll()]);
    await fetchHistory();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

// Refresh when the task dialog closes: status or dates may have changed
useDialogCloseRefresh("taskId", fetchHistory);
</script>

<style scoped>
.assignees-section {
  margin-bottom: var(--space-lg);
}

.assignees-section h2 {
  font-size: var(--text-lg);
  margin-bottom: var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.assignee-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.assignee-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.2em 0.7em;
  border-radius: var(--radius-full);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.assignee-count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: var(--radius-full);
  padding: 0 6px;
  line-height: var(--leading-loose);
}

.timeline {
  /* Every task-name cell shares one width, capped at 30% of the timeline's
     visible width (container-query units measure .timeline itself, not the
     wider scrollable inner track) */
  container-type: inline-size;
  --label-w: min(220px, 30cqw);
  --min-month-w: 100px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  /* Only the Gantt scrolls horizontally; the label column below stays put */
  overflow-x: auto;
}

/* Wrapper, not a grid minmax: the absolutely-positioned grid overlay sizes
   to its container, so axis, rows and gridlines must share one width */
.timeline-inner {
  min-width: calc(var(--label-w) + var(--months, 1) * var(--min-month-w));
}

/* Flex, not grid: a sticky grid item is clamped to its grid area (the label
   cell itself), while a flex item can slide within the full-width row */
.timeline-axis {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.axis-label {
  flex: 0 0 var(--label-w);
  /* min-width: 0 — a flex item's automatic minimum is its content width,
     which would blow every label out to its own title length instead of
     keeping one uniform column width */
  min-width: 0;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
}

.axis-track {
  flex: 1;
  min-width: 0;
  position: relative;
  height: 28px;
}

.axis-tick {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  white-space: nowrap;
}

.axis-now {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  white-space: nowrap;
  color: var(--color-primary);
  font-weight: var(--weight-semibold);
}

.timeline-rows {
  position: relative;
}

.grid-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--label-w);
  right: 0;
  pointer-events: none;
}

.grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border);
  opacity: 0.5;
}

.now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-primary);
  opacity: 0.4;
}

.timeline-row {
  display: flex;
  min-height: 44px;
  border-bottom: 1px solid var(--color-border);
}

.timeline-row:last-child {
  border-bottom: none;
}

.row-label {
  flex: 0 0 var(--label-w);
  min-width: 0;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: var(--space-xs) var(--space-sm);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.row-title {
  /* The global design system makes every button an inline-flex container
     with justify-content: center, which centers the title text and clips it
     on both sides — text-overflow never applies in flex layout. A block
     button restores left alignment and the ellipsis. */
  display: block;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-title:hover {
  color: var(--color-primary);
  text-decoration: underline;
}

.row-assignees {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  overflow: hidden;
  white-space: nowrap;
}

.row-assignees > i {
  flex-shrink: 0;
}

.assignee-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-track {
  flex: 1;
  min-width: 0;
  position: relative;
}

.task-bar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 22px;
  min-width: 12px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 4px;
  font-size: var(--text-xs);
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
}

.task-bar:hover {
  filter: brightness(1.1);
}

.bar-text {
  overflow: hidden;
  text-overflow: clip;
}

/* Open tasks are still running: hatched right edge */
.task-bar.ongoing::after {
  content: "";
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  background: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.25) 0 2px,
    transparent 2px 4px
  );
}

.empty-state {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-text-muted);
}
</style>
