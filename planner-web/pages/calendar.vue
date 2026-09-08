<template>
  <div class="calendar-page">
    <header class="page-header">
      <hgroup>
        <h1>Calendar</h1>
        <p>Tasks by due date</p>
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
        <button class="fab-button" @click="showCreateDialog = true">
          <i class="bi bi-plus-lg" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <div class="month-nav">
        <button @click="prevMonth"><i class="bi bi-chevron-left" /></button>
        <h2>{{ currentMonthName }} {{ currentYear }}</h2>
        <button @click="nextMonth"><i class="bi bi-chevron-right" /></button>
      </div>

      <div class="calendar-grid">
        <div class="calendar-header">
          <div v-for="day in dayNames" :key="day" class="calendar-day-header">
            {{ day }}
          </div>
        </div>
        <div class="calendar-body">
          <div
            v-for="(day, idx) in calendarDays"
            :key="idx"
            class="calendar-day"
            :class="{
              'other-month': !day.isCurrentMonth,
              today: day.isToday,
              'drag-over': dragOverDate === day.dateStr,
            }"
            @dragover.prevent="onDragOver(day.dateStr)"
            @dragleave="onDragLeave(day.dateStr)"
            @drop="onDrop(day.dateStr)"
          >
            <span class="day-number">{{ day.day }}</span>
            <div class="day-tasks">
              <div
                v-for="task in day.tasks"
                :key="task.id"
                class="day-task"
                :class="[
                  'priority-' + task.priority,
                  { dragging: draggingTask?.id === task.id },
                ]"
                :title="task.title"
                draggable="true"
                @dragstart="onDragStart($event, task)"
                @click="openTask(task)"
              >
                {{ task.title }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>

  <TaskCreateDialog
    :open="showCreateDialog"
    @close="showCreateDialog = false"
    @created="fetchTasks"
  />
</template>

<script setup>
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const showCreateDialog = ref(false);
const currentDate = ref(new Date());
const draggingTask = ref(null);
const dragOverDate = ref(null);

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const currentMonthName = computed(
  () => monthNames[currentDate.value.getMonth()],
);
const currentYear = computed(() => currentDate.value.getFullYear());

const calendarDays = computed(() => {
  const year = currentDate.value.getFullYear();
  const month = currentDate.value.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startPad = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = [];

  // Previous month padding
  for (let i = startPad - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const date = new Date(year, month - 1, day);
    days.push({
      day,
      date,
      dateStr: date.toISOString().split("T")[0],
      isCurrentMonth: false,
      isToday: date.getTime() === today.getTime(),
      tasks: getTasksForDate(date),
    });
  }

  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    days.push({
      day,
      date,
      dateStr: date.toISOString().split("T")[0],
      isCurrentMonth: true,
      isToday: date.getTime() === today.getTime(),
      tasks: getTasksForDate(date),
    });
  }

  // Next month padding (to fill 7-column grid)
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let day = 1; day <= remaining; day++) {
      const date = new Date(year, month + 1, day);
      days.push({
        day,
        date,
        dateStr: date.toISOString().split("T")[0],
        isCurrentMonth: false,
        isToday: date.getTime() === today.getTime(),
        tasks: getTasksForDate(date),
      });
    }
  }

  return days;
});

function getTasksForDate(date) {
  const dateStr = date.toISOString().split("T")[0];
  return tasksStore.tasks.filter(
    (t) => t.dueDate && t.dueDate.startsWith(dateStr),
  );
}

function prevMonth() {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() - 1,
    1,
  );
}

function nextMonth() {
  currentDate.value = new Date(
    currentDate.value.getFullYear(),
    currentDate.value.getMonth() + 1,
    1,
  );
}

async function fetchTasks() {
  loading.value = true;
  try {
    await tasksStore.fetchAll(projectsStore.selectedProjectFilter || undefined);
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
}

function onFilterChange(event) {
  projectsStore.setProjectFilter(event.target.value);
  fetchTasks();
}

// Refresh the calendar when the task dialog closes: tasks may have moved
// between days
useDialogCloseRefresh("taskId", fetchTasks);

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
    await fetchTasks();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

function onDragStart(event, task) {
  draggingTask.value = task;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", task.id);
}

function openTask(task) {
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

function onDragOver(dateStr) {
  dragOverDate.value = dateStr;
}

function onDragLeave(dateStr) {
  if (dragOverDate.value === dateStr) {
    dragOverDate.value = null;
  }
}

async function onDrop(dateStr) {
  dragOverDate.value = null;
  if (!draggingTask.value) return;
  const task = draggingTask.value;
  draggingTask.value = null;
  if (task.dueDate && task.dueDate.startsWith(dateStr)) return;
  try {
    await tasksStore.update(task.id, { dueDate: dateStr });
  } catch (e) {
    alert(e.response?.data?.error || "Failed to reschedule task");
  }
}
</script>

<style scoped>
.calendar-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.month-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
  flex-shrink: 0;
}

.month-nav h2 {
  margin: 0;
  min-width: 200px;
  text-align: center;
}

.month-nav button {
  background: none;
  border: none;
  font-size: var(--text-lg);
  cursor: pointer;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
}

.month-nav button:hover {
  background: var(--color-border);
}

.calendar-grid {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.calendar-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: var(--color-surface);
  flex-shrink: 0;
}

.calendar-day-header {
  padding: var(--space-sm);
  text-align: center;
  font-weight: var(--weight-bold);
  font-size: var(--text-base);
  border-bottom: 1px solid var(--color-border);
}

.calendar-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 1fr;
  flex: 1;
  min-height: 0;
}

.calendar-day {
  min-height: 0;
  padding: var(--space-xs);
  border-right: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--text-base);
  overflow: hidden;
}

.calendar-day.other-month {
  opacity: 0.3;
}

.calendar-day.drag-over {
  background: var(--color-primary-soft);
  outline: 2px dashed var(--color-primary);
  outline-offset: -2px;
}

.calendar-day.today .day-number {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: 50%;
  width: 1.5em;
  height: 1.5em;
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-number {
  display: inline-block;
  margin-bottom: var(--space-xs);
  flex-shrink: 0;
}

.day-tasks {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  min-width: 0;
}

.day-task {
  padding: 0.1em 0.3em;
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  font-size: var(--text-base);
  background: var(--color-surface);
}

.day-task.dragging {
  opacity: 0.5;
}

.day-task:hover {
  opacity: 0.8;
}

.priority-high {
  border-left: 3px solid var(--color-danger);
}
.priority-medium {
  border-left: 3px solid var(--color-primary);
}
.priority-low {
  border-left: 3px solid var(--color-text-muted);
}

@media (max-width: 767px) {
  .calendar-day-header span,
  .calendar-day-header {
    font-size: var(--text-sm);
    padding: var(--space-xs);
  }

  .calendar-day {
    font-size: var(--text-sm);
  }

  .day-task {
    font-size: var(--text-xs);
    padding: 0.05em 0.2em;
  }
}
</style>
