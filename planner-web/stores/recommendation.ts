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
  llmImproveEnabled: boolean;
  dictationEnabled: boolean;
  dictationSttConfigured: boolean;
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
    isImproveEnabled: (state) => state.config?.llmImproveEnabled ?? false,
    hasRecommendation: (state) => !!state.recommendation?.generatedAt,
    isDictationEnabled: (state) => state.config?.dictationEnabled ?? false,
    isDictationSttConfigured: (state) =>
      state.config?.dictationSttConfigured ?? false,
  },

  actions: {
    async fetchConfig() {
      try {
        const res = await api.get("/status/config");
        this.config = res.data;
      } catch {
        this.config = {
          llmRecommendationEnabled: false,
          llmImproveEnabled: false,
          dictationEnabled: false,
          dictationSttConfigured: false,
        };
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
        // The server regenerates in the background (202) and the result is
        // served by GET /recommendation: poll until the cached entry is
        // refreshed (or give up after ~2 minutes)
        const previousGeneratedAt = this.recommendation?.generatedAt ?? null;
        await api.post("/recommendation/regenerate");
        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const res = await api.get("/recommendation");
            if (res.data?.generatedAt && res.data.generatedAt !== previousGeneratedAt) {
              this.recommendation = res.data;
              return;
            }
          } catch {
            // transient error: keep polling
          }
        }
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
