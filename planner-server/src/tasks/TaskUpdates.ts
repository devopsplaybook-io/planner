import { UsersDataGet } from "../users/UsersData";
import { NotificationsTaskUpdated } from "../notifications/Notifications";
import { TasksDataGet } from "./TasksData";
import { TaskActivityDataAdd } from "./TaskActivityData";

/**
 * Fire-and-forget push notification to the task assignees (excluding the
 * actor) that the task changed. Never awaited and never throws: a
 * notification problem must not slow down or fail the mutation.
 */
export function notifyAssignees(
  taskId: string,
  actorUserId: string,
  summary: string,
): void {
  (async () => {
    const task = await TasksDataGet(taskId);
    if (!task) {
      return;
    }
    const actor = await UsersDataGet(actorUserId);
    await NotificationsTaskUpdated(
      task,
      actorUserId,
      actor?.name || "",
      summary,
    );
  })().catch(() => {
    // Notification failures are logged inside NotificationsTaskUpdated
  });
}

/**
 * Records a task mutation in the Update Feed (a single awaited insert, so
 * the entry exists when the client refetches) then pushes the notification
 * to the assignees. The feed entry is auxiliary: a failure to record it is
 * logged and never fails the mutation itself.
 */
export async function recordTaskUpdate(
  taskId: string,
  actorUserId: string,
  summary: string,
): Promise<void> {
  try {
    await TaskActivityDataAdd(taskId, actorUserId, summary);
  } catch (error) {
    console.error(
      `[Tasks] Failed to record task activity: ${(error as Error).message}`,
    );
  }
  notifyAssignees(taskId, actorUserId, summary);
}
