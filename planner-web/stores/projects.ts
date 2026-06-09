// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface Project {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  statuses: string[];
}

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as Project[],
    currentProject: null as Project | null,
  }),

  getters: {
    defaultProject: (state) => state.projects.find((p) => p.isDefault) || null,
  },

  actions: {
    async fetchAll() {
      const res = await api.get("/projects");
      this.projects = res.data;
    },

    async fetchById(id: string) {
      const res = await api.get(`/projects/${id}`);
      this.currentProject = res.data;
      return res.data;
    },

    async create(name: string, description?: string, statuses?: string[]) {
      const res = await api.post("/projects", { name, description, statuses });
      this.projects.push(res.data);
      return res.data;
    },

    async update(id: string, data: Partial<Project>) {
      const res = await api.put(`/projects/${id}`, data);
      const index = this.projects.findIndex((p) => p.id === id);
      if (index >= 0) {
        this.projects[index] = res.data;
      }
      if (this.currentProject?.id === id) {
        this.currentProject = res.data;
      }
      return res.data;
    },

    async remove(id: string) {
      await api.delete(`/projects/${id}`);
      this.projects = this.projects.filter((p) => p.id !== id);
      if (this.currentProject?.id === id) {
        this.currentProject = null;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useProjectsStore, import.meta.hot));
}
