# Notifications

The application sends Web Push notifications (PWA) to remind users about upcoming task due dates. Notifications are delivered even when the application is closed.

| Feature               | Description                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [x] Opt-in            | Users enable or disable notifications per browser/device from the Settings page (browser notification permission is requested on enable) |
| [x] Feedback          | A failed subscription attempt is reported on the Settings page instead of failing silently                                               |
| [x] Day before        | A "Task due tomorrow" notification is sent the day before a task's due date                                                              |
| [x] Day of            | A "Task due today" notification is sent on the day of a task's due date                                                                  |
| [x] Notification time | Reminders are sent from a configured hour of the day onwards (default 9:00)                                                              |
| [x] Timezone          | "Today", "tomorrow" and the notification hour are evaluated in a configurable timezone (server timezone when none is set)                |
| [x] No duplicates     | Each reminder is sent at most once per task, due date, and reminder kind; nothing is consumed while no device is subscribed              |
| [x] Completed tasks   | Tasks with the final status ("Done") do not trigger notifications                                                                        |
| [x] Audience          | Notifications are broadcast to all subscribed browsers/devices (tasks are shared across users)                                           |
| [x] Open task         | Clicking a notification opens (or focuses) the application on the related task                                                           |
| [x] Cleanup           | Expired push subscriptions are automatically removed when delivery fails                                                                 |

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-08-27_
