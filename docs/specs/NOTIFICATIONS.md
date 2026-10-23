# Notifications

The application sends Web Push notifications (PWA) to remind users about upcoming task due dates. Notifications are delivered even when the application is closed.

| Feature               | Description                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [x] Opt-in            | Users enable or disable notifications per browser/device from the Settings page (browser notification permission is requested on enable) |
| [x] Feedback          | A failed subscription attempt is reported on the Settings page instead of failing silently                                               |
| [x] Day before        | A "Task due tomorrow" notification is sent the day before a task's due date                                                              |
| [x] Day of            | A "Task due today" notification is sent on the day of a task's due date                                                                  |
| [x] Overdue           | A "Task overdue" notification is sent while a task is past its due date, at most once per day per task                                   |
| [x] Notification time | Reminders are sent from a configured hour of the day onwards (default 9:00)                                                              |
| [x] Timezone          | "Today", "tomorrow" and the notification hour are evaluated in a configurable timezone (server timezone when none is set)                |
| [x] No duplicates     | Each reminder is sent at most once per task, due date, and reminder kind; nothing is consumed while no device is subscribed              |
| [x] Completed tasks   | Tasks with the final status ("Done") do not trigger notifications                                                                        |
| [x] Audience          | Reminders go only to the assignees of the task, filtered by project visibility: admins see every project, public projects reach every authenticated user, restricted projects only their members; tasks without assignees remind nobody |
| [x] Daily digest      | Optional per-user preference: one consolidated notification listing the day's due and overdue tasks instead of one notification per task (Settings → Notifications; applies to every device of the user) |
| [x] Open task         | Clicking a notification opens (or focuses) the application on the related task                                                           |
| [x] Cleanup           | Expired push subscriptions are automatically removed when delivery fails                                                                 |
| [x] Bounded query     | A reminder run only loads tasks whose due date is before local midnight of the day after tomorrow (overdue tasks included, Done tasks excluded), instead of scanning every task with a due date |
| [x] Batched lookups   | Push subscriptions are loaded once per run and grouped per user instead of being queried inside the per-recipient loop |
| [x] No overlap        | A reminder run that fires while the previous one is still running is skipped |

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-23_
