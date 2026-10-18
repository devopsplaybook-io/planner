import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface LabelUsage {
  name: string;
  count: number;
}

export const useLabelsStore = defineStore("labels", {
  state: () => ({
    labels: [] as LabelUsage[],
  }),

  actions: {
    /**
     * Fetches the distinct labels with usage counts (optionally filtered by
     * a case-insensitive substring). The last non-empty result is kept as
     * the suggestion cache, so a fetch matching nothing never blanks the
     * autocomplete dropdowns.
     */
    async fetchAll(q?: string) {
      const params: Record<string, string> = {};
      if (q) {
        params.q = q;
      }
      const res = await api.get("/labels", { params });
      if (res.data.length > 0) {
        this.labels = res.data;
      }
      return res.data;
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useLabelsStore, import.meta.hot));
}
