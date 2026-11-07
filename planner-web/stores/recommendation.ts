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

export interface DictationConfig {
  maxDurationSeconds: number;
  maxUploadMb: number;
  defaultLanguage: string;
  languages: string[];
  estimatedRtf: number;
  engine: "embedded" | "external";
  engineState: "ready" | "preparing" | "error";
  model: string;
  // Inline dictation advertises itself so older servers keep the control hidden
  inlineJobs?: boolean;
  // Accuracy capabilities (absent on older servers; safe fallbacks below)
  hotwordsMax?: number;
  vocabularyMax?: number;
  confidenceThreshold?: number;
  confidenceAvailable?: boolean;
  translationLanguages?: string[];
  // Structured actions / read-only questions / custom phrases capabilities
  actionSchema?: number;
  applyActions?: boolean;
  ask?: boolean;
  phrasesMax?: number;
}

export interface AppConfig {
  llmRecommendationEnabled: boolean;
  llmImproveEnabled: boolean;
  dictationEnabled: boolean;
  dictationSttConfigured: boolean;
  dictation?: DictationConfig;
}

// Fallbacks used before the server config arrives (or with an older server):
// the UI must stay usable with the historic defaults.
const DEFAULT_DICTATION_LANGUAGES = [
  "auto",
  "en",
  "fr",
  "de",
  "es",
  "it",
  "pt",
  "nl",
];

export const DEFAULT_APP_CONFIG: AppConfig = {
  llmRecommendationEnabled: false,
  llmImproveEnabled: false,
  dictationEnabled: false,
  dictationSttConfigured: false,
  dictation: {
    maxDurationSeconds: 120,
    maxUploadMb: 10,
    defaultLanguage: "auto",
    languages: [...DEFAULT_DICTATION_LANGUAGES],
    estimatedRtf: 0.5,
    engine: "external",
    engineState: "ready",
    model: "",
    inlineJobs: false,
    hotwordsMax: 50,
    vocabularyMax: 200,
    confidenceThreshold: 0.6,
    confidenceAvailable: false,
    translationLanguages: DEFAULT_DICTATION_LANGUAGES.filter(
      (language) => language !== "auto",
    ),
    actionSchema: 1,
    applyActions: false,
    ask: false,
    phrasesMax: 50,
  },
};

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
    dictationMaxDurationSeconds: (state) =>
      state.config?.dictation?.maxDurationSeconds ??
      DEFAULT_APP_CONFIG.dictation!.maxDurationSeconds,
    dictationMaxUploadMb: (state) =>
      state.config?.dictation?.maxUploadMb ??
      DEFAULT_APP_CONFIG.dictation!.maxUploadMb,
    dictationLanguages: (state) =>
      state.config?.dictation?.languages?.length
        ? state.config.dictation.languages
        : DEFAULT_DICTATION_LANGUAGES,
    dictationDefaultLanguage: (state) =>
      state.config?.dictation?.defaultLanguage ??
      DEFAULT_APP_CONFIG.dictation!.defaultLanguage,
    dictationEstimatedRtf: (state) =>
      state.config?.dictation?.estimatedRtf ??
      DEFAULT_APP_CONFIG.dictation!.estimatedRtf,
    dictationEngineState: (state) =>
      state.config?.dictation?.engineState ??
      DEFAULT_APP_CONFIG.dictation!.engineState,
    dictationInlineJobs: (state) =>
      state.config?.dictation?.inlineJobs ??
      DEFAULT_APP_CONFIG.dictation!.inlineJobs ??
      false,
    dictationHotwordsMax: (state) =>
      state.config?.dictation?.hotwordsMax ??
      DEFAULT_APP_CONFIG.dictation!.hotwordsMax!,
    dictationVocabularyMax: (state) =>
      state.config?.dictation?.vocabularyMax ??
      DEFAULT_APP_CONFIG.dictation!.vocabularyMax!,
    dictationConfidenceThreshold: (state) =>
      state.config?.dictation?.confidenceThreshold ??
      DEFAULT_APP_CONFIG.dictation!.confidenceThreshold!,
    dictationConfidenceAvailable: (state) =>
      state.config?.dictation?.confidenceAvailable ??
      DEFAULT_APP_CONFIG.dictation!.confidenceAvailable ??
      false,
    dictationTranslationLanguages: (state) => {
      const configured = state.config?.dictation?.translationLanguages;
      if (configured?.length) {
        return configured.filter((language) => language !== "auto");
      }
      return (
        DEFAULT_APP_CONFIG.dictation!.translationLanguages ||
        DEFAULT_DICTATION_LANGUAGES.filter((language) => language !== "auto")
      );
    },
    dictationActionSchema: (state) =>
      state.config?.dictation?.actionSchema ??
      DEFAULT_APP_CONFIG.dictation!.actionSchema ??
      1,
    dictationApplyActions: (state) =>
      state.config?.dictation?.applyActions ??
      DEFAULT_APP_CONFIG.dictation!.applyActions ??
      false,
    dictationAskEnabled: (state) =>
      state.config?.dictation?.ask ??
      DEFAULT_APP_CONFIG.dictation!.ask ??
      false,
    dictationPhrasesMax: (state) =>
      state.config?.dictation?.phrasesMax ??
      DEFAULT_APP_CONFIG.dictation!.phrasesMax!,
  },

  actions: {
    async fetchConfig() {
      try {
        const res = await api.get("/status/config");
        this.config = res.data;
      } catch {
        this.config = { ...DEFAULT_APP_CONFIG, dictation: { ...DEFAULT_APP_CONFIG.dictation! } };
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
