import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export const useStatusesStore = defineStore("statuses", {
  state: () => ({
    catalog: [] as string[],
  }),

  actions: {
    async fetchAll() {
      const res = await api.get("/statuses");
      this.catalog = res.data.statuses || [];
      return this.catalog;
    },

    async save(statuses: string[]) {
      const res = await api.put("/statuses", { statuses });
      this.catalog = res.data.statuses || [];
      return this.catalog;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStatusesStore, import.meta.hot));
}
