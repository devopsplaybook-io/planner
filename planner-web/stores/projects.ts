import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import {
  isDescendantName,
  isNameTakenIn,
  normalizeName,
} from "../utils/projectHierarchy";

export interface ProjectUserAccess {
  userId: string;
  permission: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  archived: boolean;
  visibility: string;
  userAccess: ProjectUserAccess[];
  statuses: string[];
}

const PERMISSION_LABELS: Record<string, string> = {
  all: "All",
  update: "Update tasks",
  comment: "Comment",
  view: "View",
};

export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] || "All";
}

/**
 * The user's permission level on a project: admins have every right, and
 * the levels only restrict memberships of restricted projects (public
 * projects grant every authenticated user full rights). Missing entries
 * default to "all" for robustness, mirroring the server's tolerant parsing.
 */
export function projectPermissionFor(
  project: Project | null | undefined,
  userId: string | undefined,
  isAdmin: boolean,
): string {
  if (isAdmin) {
    return "all";
  }
  if (!project || project.visibility !== "restricted") {
    return "all";
  }
  const entry = (project.userAccess || []).find((e) => e.userId === userId);
  return entry?.permission || "all";
}

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as Project[],
    currentProject: null as Project | null,
    selectedProjectFilter:
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("projectId")) ||
      "",
  }),

  getters: {
    defaultProject: (state) => state.projects.find((p) => p.isDefault) || null,
    activeProjects: (state) => state.projects.filter((p) => !p.archived),
    /**
     * Ids of a project's whole subtree (the project itself + every project
     * whose name starts with its path). Ids only, so the persisted
     * localStorage filter is unaffected by renames.
     */
    subtreeProjectIds: (state) => (projectId: string) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) {
        return projectId ? [projectId] : [];
      }
      const base = normalizeName(project.name);
      const ids = [project.id];
      for (const p of state.projects) {
        if (
          p.id !== project.id &&
          isDescendantName(normalizeName(p.name), base)
        ) {
          ids.push(p.id);
        }
      }
      return ids;
    },
    /** All descendants of a project (any depth). */
    descendantsOf: (state) => (projectId: string) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) {
        return [];
      }
      const base = normalizeName(project.name);
      return state.projects.filter(
        (p) =>
          p.id !== project.id && isDescendantName(normalizeName(p.name), base),
      );
    },
    /**
     * Whether a normalized name is already used by another project
     * (case-insensitive). Project mutations are admin-only, so validating
     * in the admin surfaces covers every create/rename.
     */
    isNameTaken: (state) => (name: string, excludeId?: string) =>
      isNameTakenIn(state.projects, name, excludeId),
  },

  actions: {
    setProjectFilter(projectId: string) {
      this.selectedProjectFilter = projectId;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("projectId", projectId);
      }
    },
    async fetchAll() {
      const res = await api.get("/projects");
      this.projects = res.data;
    },

    async fetchById(id: string) {
      const res = await api.get(`/projects/${id}`);
      this.currentProject = res.data;
      return res.data;
    },

    async create(
      name: string,
      description?: string,
      statuses?: string[],
      visibility?: string,
      userAccess?: ProjectUserAccess[],
    ) {
      const res = await api.post("/projects", {
        name,
        description,
        statuses,
        visibility,
        userAccess,
      });
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
