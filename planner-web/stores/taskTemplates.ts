import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface TemplateComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
  dateUpdated?: string;
}

export interface TemplateAutomation {
  scheduleCron: string | null;
  skipIfPreviousNotDone: boolean;
  addDateToTitle: boolean;
  instanceStatus: string | null;
}

export interface TaskTemplate {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: string;
  checklist: { text: string; done: boolean }[];
  automation: TemplateAutomation;
  assignees: { userId: string; userName?: string }[];
  comments: TemplateComment[];
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

export const useTaskTemplatesStore = defineStore("taskTemplates", {
  state: () => ({
    templates: [] as TaskTemplate[],
    currentTemplate: null as TaskTemplate | null,
  }),

  actions: {
    async fetchAll(params?: {
      projectId?: string;
      projectIds?: string[];
      q?: string;
    }) {
      const query: Record<string, string> = {};
      if (params?.projectId) {
        query.projectId = params.projectId;
      }
      if (params?.projectIds && params.projectIds.length > 0) {
        query.projectIds = params.projectIds.join(",");
      }
      if (params?.q) {
        query.q = params.q;
      }
      const res = await api.get("/task-templates", { params: query });
      this.templates = res.data;
      return res.data as TaskTemplate[];
    },

    async fetchById(id: string) {
      const res = await api.get(`/task-templates/${id}`);
      this.currentTemplate = res.data;
      return res.data;
    },

    async create(data: {
      projectId: string;
      title: string;
      description?: string;
      priority?: string;
      checklist?: { text: string; done: boolean }[];
      automation?: Partial<TemplateAutomation>;
      assignees?: string[];
      labels?: string[];
    }) {
      const res = await api.post("/task-templates", data);
      this.templates.unshift(res.data);
      return res.data;
    },

    async update(id: string, data: Record<string, unknown>) {
      const res = await api.put(`/task-templates/${id}`, data);
      const index = this.templates.findIndex((t) => t.id === id);
      if (index >= 0) {
        this.templates[index] = res.data;
      }
      if (this.currentTemplate?.id === id) {
        this.currentTemplate = res.data;
      }
      return res.data;
    },

    async remove(id: string) {
      await api.delete(`/task-templates/${id}`);
      this.templates = this.templates.filter((t) => t.id !== id);
      if (this.currentTemplate?.id === id) {
        this.currentTemplate = null;
      }
    },

    async createInstance(id: string) {
      const res = await api.post(`/task-templates/${id}/create-instance`);
      return res.data;
    },

    async addComment(templateId: string, text: string) {
      const res = await api.post(`/task-templates/${templateId}/comments`, {
        text,
      });
      const template = this.templates.find((t) => t.id === templateId);
      if (template) {
        template.comments.push(res.data);
      }
      if (this.currentTemplate?.id === templateId) {
        this.currentTemplate.comments.push(res.data);
      }
      return res.data;
    },

    async updateComment(templateId: string, commentId: string, text: string) {
      const res = await api.put(
        `/task-templates/${templateId}/comments/${commentId}`,
        { text },
      );
      const replace = (comments: TemplateComment[]) => {
        const idx = comments.findIndex((c) => c.id === commentId);
        if (idx >= 0) comments[idx] = res.data;
      };
      const template = this.templates.find((t) => t.id === templateId);
      if (template) {
        replace(template.comments);
      }
      if (this.currentTemplate?.id === templateId) {
        replace(this.currentTemplate.comments);
      }
      return res.data;
    },

    async deleteComment(templateId: string, commentId: string) {
      await api.delete(
        `/task-templates/${templateId}/comments/${commentId}`,
      );
      const drop = (comments: TemplateComment[]) => {
        const idx = comments.findIndex((c) => c.id === commentId);
        if (idx >= 0) comments.splice(idx, 1);
      };
      const template = this.templates.find((t) => t.id === templateId);
      if (template) {
        drop(template.comments);
      }
      if (this.currentTemplate?.id === templateId) {
        drop(this.currentTemplate.comments);
      }
    },

    async uploadAttachment(templateId: string, file: File) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(
        `/task-templates/${templateId}/attachments`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const template = this.templates.find((t) => t.id === templateId);
      if (template) {
        template.attachments.push(res.data);
      }
      if (this.currentTemplate?.id === templateId) {
        this.currentTemplate.attachments.push(res.data);
      }
      return res.data;
    },

    async deleteAttachment(templateId: string, attachmentId: string) {
      await api.delete(
        `/task-templates/${templateId}/attachments/${attachmentId}`,
      );
      const drop = (
        attachments: { id: string; fileName: string; filePath: string; dateCreated: string }[],
      ) => {
        const idx = attachments.findIndex((a) => a.id === attachmentId);
        if (idx >= 0) attachments.splice(idx, 1);
      };
      const template = this.templates.find((t) => t.id === templateId);
      if (template) {
        drop(template.attachments);
      }
      if (this.currentTemplate?.id === templateId) {
        drop(this.currentTemplate.attachments);
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useTaskTemplatesStore, import.meta.hot),
  );
}
