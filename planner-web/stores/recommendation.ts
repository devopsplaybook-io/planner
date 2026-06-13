import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface RecommendationTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
}

export interface Recommendation {
  generatedAt: string | null;
  analysis: string | null;
  recommendations: string | null;
  tasks: RecommendationTask[];
}

export interface AppConfig {
  llmRecommendationEnabled: boolean;
}

export const useRecommendationStore = defineStore("recommendation", {
  state: () => ({
    recommendation: null as Recommendation | null,
    config: null as AppConfig | null,
    loading: false,
    generating: false,
  }),

  getters: {
    isLlmEnabled: (state) => state.config?.llmRecommendationEnabled ?? false,
    hasRecommendation: (state) => !!state.recommendation?.generatedAt,
  },

  actions: {
    async fetchConfig() {
      try {
        const res = await api.get("/status/config");
        this.config = res.data;
      } catch {
        this.config = { llmRecommendationEnabled: false };
      }
    },

    async fetchRecommendation() {
      this.loading = true;
      try {
        const res = await api.get("/recommendation");
        this.recommendation = res.data;
      } catch {
        this.recommendation = null;
      } finally {
        this.loading = false;
      }
    },

    async regenerateRecommendation() {
      this.generating = true;
      try {
        const res = await api.post("/recommendation/regenerate");
        this.recommendation = res.data;
      } catch {
        // keep existing recommendation on failure
      } finally {
        this.generating = false;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useRecommendationStore, import.meta.hot),
  );
}
