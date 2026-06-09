// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
}

export interface TaskAssignee {
  userId: string;
  userName?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate?: string;
  checklist: ChecklistItem[];
  assignees: TaskAssignee[];
  comments: TaskComment[];
  attachments: unknown[];
  labels: string[];
  dateCreated: string;
  dateUpdated: string;
}

export const useTasksStore = defineStore("tasks", {
  state: () => ({
    tasks: [] as Task[],
    currentTask: null as Task | null,
  }),

  actions: {
    async fetchAll(projectId?: string) {
      const params = projectId ? { projectId } : {};
      const res = await api.get("/tasks", { params });
      this.tasks = res.data;
    },

    async fetchById(id: string) {
      const res = await api.get(`/tasks/${id}`);
      this.currentTask = res.data;
      return res.data;
    },

    async create(data: {
      projectId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      dueDate?: string;
      assignees?: string[];
      labels?: string[];
    }) {
      const res = await api.post("/tasks", data);
      this.tasks.push(res.data);
      return res.data;
    },

    async update(id: string, data: Partial<Task>) {
      const res = await api.put(`/tasks/${id}`, data);
      const index = this.tasks.findIndex((t) => t.id === id);
      if (index >= 0) {
        this.tasks[index] = res.data;
      }
      if (this.currentTask?.id === id) {
        this.currentTask = res.data;
      }
      return res.data;
    },

    async remove(id: string) {
      await api.delete(`/tasks/${id}`);
      this.tasks = this.tasks.filter((t) => t.id !== id);
      if (this.currentTask?.id === id) {
        this.currentTask = null;
      }
    },

    async addComment(taskId: string, text: string) {
      const res = await api.post(`/tasks/${taskId}/comments`, { text });
      const taskIdx = this.tasks.findIndex((t) => t.id === taskId);
      if (taskIdx >= 0) {
        this.tasks[taskIdx].comments.push(res.data);
      }
      if (this.currentTask?.id === taskId) {
        this.currentTask.comments.push(res.data);
      }
      return res.data;
    },

    async deleteComment(taskId: string, commentId: string) {
      await api.delete(`/tasks/${taskId}/comments/${commentId}`);
      const task = this.tasks.find((t) => t.id === taskId);
      if (task) {
        task.comments = task.comments.filter((c) => c.id !== commentId);
      }
      if (this.currentTask?.id === taskId) {
        this.currentTask.comments = this.currentTask.comments.filter(
          (c) => c.id !== commentId,
        );
      }
    },

    async addAssignee(taskId: string, userId: string) {
      await api.post(`/tasks/${taskId}/assignees`, { userId });
    },

    async removeAssignee(taskId: string, userId: string) {
      await api.delete(`/tasks/${taskId}/assignees/${userId}`);
    },

    async setLabels(taskId: string, labels: string[]) {
      await api.post(`/tasks/${taskId}/labels`, { labels });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTasksStore, import.meta.hot));
}
