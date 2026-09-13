import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface StatusCatalogEntry {
  name: string;
  color: string;
}

export const DEFAULT_STATUS_COLOR = "#6b7280";

export const useStatusesStore = defineStore("statuses", {
  state: () => ({
    catalog: [] as StatusCatalogEntry[],
  }),

  getters: {
    catalogNames: (state): string[] => state.catalog.map((s) => s.name),
  },

  actions: {
    async fetchAll() {
      const res = await api.get("/statuses");
      this.catalog = res.data.statuses || [];
      return this.catalog;
    },

    async save(statuses: StatusCatalogEntry[]) {
      const res = await api.put("/statuses", { statuses });
      this.catalog = res.data.statuses || [];
      return this.catalog;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStatusesStore, import.meta.hot));
}
