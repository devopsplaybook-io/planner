import axios from "axios";
import * as fs from "fs-extra";
import * as path from "path";
import * as cron from "node-cron";
import { Config } from "../Config";
import { DbUtilsQuerySQL, DbUtilsGetType } from "../utils/DbUtils";

const logger = console;

let config: Config;

// ── Public Interface ──────────────────────────────────────────────────────────

export async function RecommendationInit(configIn: Config): Promise<void> {
  config = configIn;

  if (configIn.LLM_RECOMMENDATION_ENABLED && configIn.LLM_API_KEY) {
    logger.info(
      `[Recommendation] Scheduling LLM recommendation: ${configIn.LLM_RECOMMENDATION_SCHEDULE_CRON}`,
    );
    cron.schedule(configIn.LLM_RECOMMENDATION_SCHEDULE_CRON, () => {
      RecommendationGenerateAll().catch((err) =>
        logger.error(
          `[Recommendation] Failed to generate scheduled recommendations: ${err.message}`,
        ),
      );
    });
  } else {
    logger.info(
      "[Recommendation] LLM recommendation feature disabled (no API key or feature not enabled)",
    );
  }
}

export interface RecommendationResult {
  generatedAt: string;
  analysis: string;
  recommendations: string;
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate?: string;
  }[];
}

export async function RecommendationGetCached(
  userId: string,
): Promise<RecommendationResult | null> {
  try {
    const filePath = getFilePath(userId);
    if (!(await fs.pathExists(filePath))) {
      return null;
    }
    return await fs.readJson(filePath);
  } catch (error) {
    logger.error(
      `[Recommendation] Failed to read cached recommendation for user ${userId}: ${error.message}`,
    );
    return null;
  }
}

// ── Generate for all users ────────────────────────────────────────────────────

export async function RecommendationGenerateAll(): Promise<void> {
  const users = await DbUtilsQuerySQL(SQL_QUERIES.LIST_USERS[DbUtilsGetType()]);
  for (const user of users) {
    try {
      await RecommendationGenerateForUser(user.id);
    } catch (err) {
      logger.error(
        `[Recommendation] Failed to generate recommendation for user ${user.id}: ${err.message}`,
      );
    }
  }
}

// ── Generate for a single user ────────────────────────────────────────────────

export async function RecommendationGenerateForUser(
  userId: string,
): Promise<void> {
  logger.info(`[Recommendation] Collecting task statistics for user ${userId}`);

  const stats = await CollectStats(userId);
  const prompt = BuildPrompt(stats);
  // eslint-disable-next-line no-useless-assignment
  let analysis = "";
  let recommendations = "";

  try {
    const llmResponse = await callLLMWithRetry(prompt);
    const fullContent = llmResponse || "";

    if (!fullContent || fullContent.trim().length < 20) {
      logger.warn(
        `[Recommendation] LLM returned empty or very short response for user ${userId}`,
      );
      analysis =
        "LLM returned an empty response. Please check API configuration.";
    } else {
      const analysisMatch = fullContent.match(
        /^## Analysis\s*\n([\s\S]*?)(?=\n^## Recommendations|\n?$)/im,
      );
      const recommendationsMatch = fullContent.match(
        /^## Recommendations\s*\n([\s\S]*)/im,
      );
      const parsedAnalysis = (analysisMatch?.[1] || fullContent).trim();
      const parsedRecommendations = (recommendationsMatch?.[1] || "").trim();

      if (!parsedAnalysis && !parsedRecommendations) {
        analysis = fullContent.trim();
        recommendations = "";
      } else {
        analysis = parsedAnalysis;
        recommendations = parsedRecommendations;
      }
    }
  } catch (error) {
    logger.error(
      `[Recommendation] LLM API call failed for user ${userId}: ${error.message}`,
    );
    analysis = `LLM recommendation generation failed: ${error.message}`;
    recommendations = "";
  }

  const result: RecommendationResult = {
    generatedAt: new Date().toISOString(),
    analysis,
    recommendations,
    tasks: stats.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
    })),
  };

  const filePath = getFilePath(userId);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, result);
  logger.info(
    `[Recommendation] Recommendation generated and cached for user ${userId}`,
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function getFilePath(userId: string): string {
  return path.join(config.DATA_DIR, `recommendation-${userId}.json`);
}

// ── LLM API call with retry ───────────────────────────────────────────────────

async function callLLMWithRetry(
  prompt: string,
  maxRetries = 3,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        config.LLM_API_URL,
        {
          model: config.LLM_MODEL,
          temperature: 0.3,
          max_tokens: 4000,
          messages: [
            {
              role: "system",
              content:
                "You are a productivity and Kanban expert. " +
                "Analyze the provided task statistics and produce a concise report.\n\n" +
                "IMPORTANT: Address the user directly using 'you' and 'your' throughout the report. " +
                "For example, say 'You have 3 overdue tasks' instead of 'The user has 3 overdue tasks'.\n\n" +
                "Context:\n" +
                "- Tasks have statuses: 'To Do', 'In Progress', 'Done', or custom statuses.\n" +
                "- Priorities: 'high', 'medium', 'low'.\n" +
                "- dueDate is an ISO date string; absence means no due date set.\n" +
                "- Tasks reference their project, labels, and assignees.\n\n" +
                "Output your answer in two clear sections:\n" +
                "## Analysis\n" +
                "A concise analysis (3-5 paragraphs) covering:\n" +
                "- Overall workload and task distribution\n" +
                "- Overdue or at-risk tasks that need immediate attention\n" +
                "- Patterns in completed tasks (completion rate, delays)\n" +
                "- Observations about task prioritization\n\n" +
                'IMPORTANT: Always reference tasks by their ID (e.g., "task-123") and title when discussing them.\n\n' +
                "## Recommendations\n" +
                "Actionable recommendations (3-6 bullet points) prioritized by impact. " +
                "Each bullet must be specific and directly reference the tasks provided. " +
                "Include Kanban best practices: WIP limits, backlog hygiene, due date management. " +
                "Do NOT give generic advice like 'stay organized'—be concrete and reference actual task IDs.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LLM_API_KEY}`,
          },
          timeout: 60000,
        },
      );
      return response.data?.choices?.[0]?.message?.content || "";
    } catch (error) {
      lastError = error as Error;
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(
          `[Recommendation] LLM API attempt ${attempt + 1} failed (status=${status}), retrying in ${delay}ms: ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("LLM API call failed after retries");
}

// ── Statistics Collection ─────────────────────────────────────────────────────

interface TaskStats {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
  labels: string[];
  projectId: string;
  dateCreated: string;
  dateUpdated: string;
}

interface UserRecommendationStats {
  userId: string;
  userName: string;
  totalAssigned: number;
  totalUnassigned: number;
  totalDone: number;
  overdue: TaskStats[];
  inProgress: TaskStats[];
  todo: TaskStats[];
  recentlyCompleted: TaskStats[];
  tasks: TaskStats[];
  performanceStats: {
    completedCount: number;
    avgCompletionDays: number;
    overdueCount: number;
    wipCount: number;
  };
}

async function CollectStats(userId: string): Promise<UserRecommendationStats> {
  const dbType = DbUtilsGetType();
  const now = new Date().toISOString();

  // Get user info
  const userRows = await DbUtilsQuerySQL(SQL_QUERIES.GET_USER[dbType], [
    userId,
  ]);
  const userName = userRows.length > 0 ? userRows[0].name : "Unknown";

  // Assigned tasks (not Done)
  const assignedTasks = await getTasksForUser(userId, false);

  // Unassigned tasks (not Done)
  const unassignedTasks = await getUnassignedTasks();

  // Done tasks assigned to user (for performance stats)
  const doneTasks = await getTasksForUser(userId, true);

  // Categorize
  const overdue: TaskStats[] = [];
  const inProgress: TaskStats[] = [];
  const todo: TaskStats[] = [];

  for (const task of assignedTasks) {
    if (task.dueDate && task.dueDate < now && task.status !== "Done") {
      overdue.push(task);
    }
    if (task.status === "In Progress") {
      inProgress.push(task);
    }
    if (task.status === "To Do") {
      todo.push(task);
    }
  }

  // Recently completed (last 10)
  const recentlyCompleted = doneTasks
    .sort(
      (a, b) =>
        new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
    )
    .slice(0, 10);

  // Performance stats
  let avgCompletionDays = 0;
  if (doneTasks.length > 0) {
    const totalDays = doneTasks.reduce((sum, t) => {
      const created = new Date(t.dateCreated).getTime();
      const updated = new Date(t.dateUpdated).getTime();
      return sum + (updated - created) / (1000 * 60 * 60 * 24);
    }, 0);
    avgCompletionDays = Math.round((totalDays / doneTasks.length) * 10) / 10;
  }

  const allTasks = [...assignedTasks, ...unassignedTasks];

  return {
    userId,
    userName,
    totalAssigned: assignedTasks.length,
    totalUnassigned: unassignedTasks.length,
    totalDone: doneTasks.length,
    overdue,
    inProgress,
    todo,
    recentlyCompleted,
    tasks: allTasks,
    performanceStats: {
      completedCount: doneTasks.length,
      avgCompletionDays,
      overdueCount: overdue.length,
      wipCount: inProgress.length,
    },
  };
}

async function getTasksForUser(
  userId: string,
  doneOnly: boolean,
): Promise<TaskStats[]> {
  const dbType = DbUtilsGetType();
  const sql = doneOnly
    ? SQL_QUERIES.TASKS_BY_USER_DONE[dbType]
    : SQL_QUERIES.TASKS_BY_USER_NOT_DONE[dbType];

  const rows = await DbUtilsQuerySQL(sql, [userId]);

  const tasks: TaskStats[] = [];
  for (const row of rows) {
    const labelRows = await DbUtilsQuerySQL(SQL_QUERIES.GET_LABELS[dbType], [
      row.id,
    ]);
    tasks.push({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate || undefined,
      labels: labelRows.map((l) => l.name),
      projectId: row.projectId,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated,
    });
  }
  return tasks;
}

async function getUnassignedTasks(): Promise<TaskStats[]> {
  const dbType = DbUtilsGetType();
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.TASKS_UNASSIGNED_NOT_DONE[dbType],
  );

  const tasks: TaskStats[] = [];
  for (const row of rows) {
    const labelRows = await DbUtilsQuerySQL(SQL_QUERIES.GET_LABELS[dbType], [
      row.id,
    ]);
    tasks.push({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate || undefined,
      labels: labelRows.map((l) => l.name),
      projectId: row.projectId,
      dateCreated: row.dateCreated,
      dateUpdated: row.dateUpdated,
    });
  }
  return tasks;
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function BuildPrompt(stats: UserRecommendationStats): string {
  const PROMPT_MAX_LENGTH = 8000;
  const lines: string[] = [];

  lines.push(`Here are your task statistics, ${stats.userName}:\n`);

  // Summary
  lines.push("--- Summary ---");
  lines.push(`Total assigned tasks (not done): ${stats.totalAssigned}`);
  lines.push(`Total unassigned tasks (not done): ${stats.totalUnassigned}`);
  lines.push(`Total completed tasks: ${stats.totalDone}`);
  lines.push(
    `Average completion time: ${stats.performanceStats.avgCompletionDays} days`,
  );
  lines.push(`Work In Progress: ${stats.performanceStats.wipCount}`);
  lines.push(`Overdue tasks: ${stats.performanceStats.overdueCount}`);
  lines.push("");

  // Overdue tasks
  if (stats.overdue.length > 0) {
    lines.push("--- Overdue Tasks (require immediate attention) ---");
    for (const t of stats.overdue) {
      lines.push(
        `  - [${t.id}] "${t.title}" (priority=${t.priority}, due=${t.dueDate}, status=${t.status}, labels=${t.labels.join(",") || "none"})`,
      );
    }
    lines.push("");
  }

  // In Progress
  if (stats.inProgress.length > 0) {
    lines.push("--- Tasks In Progress ---");
    for (const t of stats.inProgress) {
      lines.push(
        `  - [${t.id}] "${t.title}" (priority=${t.priority}, due=${t.dueDate || "none"}, labels=${t.labels.join(",") || "none"})`,
      );
    }
    lines.push("");
  }

  // To Do
  if (stats.todo.length > 0) {
    lines.push("--- To Do Tasks ---");
    for (const t of stats.todo.slice(0, 15)) {
      lines.push(
        `  - [${t.id}] "${t.title}" (priority=${t.priority}, due=${t.dueDate || "none"}, labels=${t.labels.join(",") || "none"})`,
      );
    }
    if (stats.todo.length > 15) {
      lines.push(`  (${stats.todo.length - 15} more omitted)`);
    }
    lines.push("");
  }

  // Unassigned
  if (stats.totalUnassigned > 0) {
    lines.push(
      `--- Unassigned Tasks (${stats.totalUnassigned} total, available to pick up) ---`,
    );
    for (const t of stats.tasks
      .filter(
        (task) =>
          !stats.overdue.includes(task) &&
          !stats.inProgress.includes(task) &&
          !stats.todo.includes(task),
      )
      .slice(0, 10)) {
      lines.push(
        `  - [${t.id}] "${t.title}" (priority=${t.priority}, due=${t.dueDate || "none"})`,
      );
    }
    lines.push("");
  }

  // Recently completed
  if (stats.recentlyCompleted.length > 0) {
    lines.push("--- Recently Completed ---");
    for (const t of stats.recentlyCompleted.slice(0, 5)) {
      lines.push(
        `  - [${t.id}] "${t.title}" (completed ${t.dateUpdated}, created ${t.dateCreated})`,
      );
    }
    lines.push("");
  }

  lines.push(
    "Based on your data above, provide your Analysis and Recommendations. " +
      "Reference tasks by their ID and title. Address me directly using 'you' and 'your'. Focus on actionable advice.",
  );

  const prompt = lines.join("\n");
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return prompt.substring(0, PROMPT_MAX_LENGTH);
  }
  return prompt;
}

// ── SQL Queries ───────────────────────────────────────────────────────────────

const SQL_QUERIES = {
  LIST_USERS: {
    postgres: "SELECT id, name FROM users",
    sqlite: "SELECT id, name FROM users",
  },
  GET_USER: {
    postgres: 'SELECT id, name FROM users WHERE "id" = $1',
    sqlite: "SELECT id, name FROM users WHERE id = ?",
  },
  TASKS_BY_USER_NOT_DONE: {
    postgres:
      'SELECT t.id, t."projectId", t.title, t.status, t.priority, t."dueDate", t."dateCreated", t."dateUpdated" ' +
      'FROM tasks t INNER JOIN task_assignees ta ON t.id = ta."taskId" ' +
      "WHERE ta.\"userId\" = $1 AND t.status != 'Done'",
    sqlite:
      "SELECT t.id, t.projectId, t.title, t.status, t.priority, t.dueDate, t.dateCreated, t.dateUpdated " +
      "FROM tasks t INNER JOIN task_assignees ta ON t.id = ta.taskId " +
      "WHERE ta.userId = ? AND t.status != 'Done'",
  },
  TASKS_BY_USER_DONE: {
    postgres:
      'SELECT t.id, t."projectId", t.title, t.status, t.priority, t."dueDate", t."dateCreated", t."dateUpdated" ' +
      'FROM tasks t INNER JOIN task_assignees ta ON t.id = ta."taskId" ' +
      "WHERE ta.\"userId\" = $1 AND t.status = 'Done'",
    sqlite:
      "SELECT t.id, t.projectId, t.title, t.status, t.priority, t.dueDate, t.dateCreated, t.dateUpdated " +
      "FROM tasks t INNER JOIN task_assignees ta ON t.id = ta.taskId " +
      "WHERE ta.userId = ? AND t.status = 'Done'",
  },
  TASKS_UNASSIGNED_NOT_DONE: {
    postgres:
      'SELECT t.id, t."projectId", t.title, t.status, t.priority, t."dueDate", t."dateCreated", t."dateUpdated" ' +
      "FROM tasks t WHERE t.id NOT IN (SELECT \"taskId\" FROM task_assignees) AND t.status != 'Done'",
    sqlite:
      "SELECT t.id, t.projectId, t.title, t.status, t.priority, t.dueDate, t.dateCreated, t.dateUpdated " +
      "FROM tasks t WHERE t.id NOT IN (SELECT taskId FROM task_assignees) AND t.status != 'Done'",
  },
  GET_LABELS: {
    postgres: 'SELECT name FROM task_labels WHERE "taskId" = $1',
    sqlite: "SELECT name FROM task_labels WHERE taskId = ?",
  },
};
