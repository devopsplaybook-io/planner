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
  attachments: {
    id: string;
    fileName: string;
    filePath: string;
    dateCreated: string;
  }[];
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

    async fetchNextView() {
      const res = await api.get("/views/next");
      return res.data;
    },

    async fetchDashboard(params?: { projectId?: string; labels?: string }) {
      const res = await api.get("/views/dashboard", { params });
      return res.data;
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

    async uploadAttachment(taskId: string, file: File) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(`/tasks/${taskId}/attachments`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const task = this.tasks.find((t) => t.id === taskId);
      if (task) {
        task.attachments.push(res.data);
      }
      if (this.currentTask?.id === taskId) {
        this.currentTask.attachments.push(res.data);
      }
      return res.data;
    },

    async deleteAttachment(taskId: string, attachmentId: string) {
      await api.delete(`/tasks/${taskId}/attachments/${attachmentId}`);
      const task = this.tasks.find((t) => t.id === taskId);
      if (task) {
        task.attachments = task.attachments.filter(
          (a) => a.id !== attachmentId,
        );
      }
      if (this.currentTask?.id === taskId) {
        this.currentTask.attachments = this.currentTask.attachments.filter(
          (a) => a.id !== attachmentId,
        );
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTasksStore, import.meta.hot));
}
