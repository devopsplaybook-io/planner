<template>
  <div class="calendar-page">
    <hgroup>
      <h1>Calendar</h1>
      <p>Tasks by due date</p>
    </hgroup>

    <div v-if="loading" class="loading-indicator"></div>

    <template v-else>
      <div class="month-nav">
        <button @click="prevMonth"><i class="bi bi-chevron-left"></i></button>
        <h2>{{ currentMonthName }} {{ currentYear }}</h2>
        <button @click="nextMonth"><i class="bi bi-chevron-right"></i></button>
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
            :class="{ 'other-month': !day.isCurrentMonth, today: day.isToday }"
          >
            <span class="day-number">{{ day.day }}</span>
            <div class="day-tasks">
              <div
                v-for="task in day.tasks"
                :key="task.id"
                class="day-task"
                :class="'priority-' + task.priority"
                :title="task.title"
                @click="router.push(`/tasks/${task.id}`)"
              >
                {{ task.title }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const router = useRouter();

const loading = ref(true);
const currentDate = ref(new Date());

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

onMounted(async () => {
  try {
    await tasksStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.month-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1em;
  margin-bottom: 1em;
}

.month-nav h2 {
  margin: 0;
  min-width: 200px;
  text-align: center;
}

.month-nav button {
  background: none;
  border: none;
  font-size: 1.2em;
  cursor: pointer;
  padding: 0.3em 0.6em;
  border-radius: 0.3em;
}

.month-nav button:hover {
  background: var(--pico-muted-border-color);
}

.calendar-grid {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pico-muted-border-color);
  border-radius: 0.3em;
  overflow: hidden;
}

.calendar-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: var(--pico-card-background-color);
}

.calendar-day-header {
  padding: 0.5em;
  text-align: center;
  font-weight: bold;
  font-size: 0.85em;
  border-bottom: 1px solid var(--pico-muted-border-color);
}

.calendar-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.calendar-day {
  min-height: 80px;
  padding: 0.3em;
  border-right: 1px solid var(--pico-muted-border-color);
  border-bottom: 1px solid var(--pico-muted-border-color);
  font-size: 0.85em;
}

.calendar-day.other-month {
  opacity: 0.3;
}

.calendar-day.today .day-number {
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  border-radius: 50%;
  width: 1.5em;
  height: 1.5em;
  display: flex;
  align-items: center;
  justify-content: center;
}

.day-number {
  display: inline-block;
  margin-bottom: 0.2em;
}

.day-tasks {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
}

.day-task {
  padding: 0.1em 0.3em;
  border-radius: 0.2em;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85em;
  background: var(--pico-card-background-color);
}

.day-task:hover {
  opacity: 0.8;
}

.priority-high {
  border-left: 3px solid var(--pico-del-color);
}
.priority-medium {
  border-left: 3px solid var(--pico-primary);
}
.priority-low {
  border-left: 3px solid var(--pico-muted-color);
}
</style>
