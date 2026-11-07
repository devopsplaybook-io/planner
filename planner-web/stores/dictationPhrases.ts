import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface DictationPhrase {
  id: string;
  phrase: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
  dateCreated: string;
}

export interface DictationPhraseInput {
  phrase: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
}

function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: string } } })
    ?.response?.data?.error;
  return message || fallback;
}

/**
 * Per-user custom command phrases. A phrase maps a spoken prefix to exactly
 * one project or template; every action returns its error instead of
 * throwing so the editor can render inline feedback.
 */
export const useDictationPhrasesStore = defineStore("dictationPhrases", {
  state: () => ({
    phrases: [] as DictationPhrase[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    count: (state) => state.phrases.length,
  },

  actions: {
    async fetchAll(): Promise<{ error?: string }> {
      this.loading = true;
      try {
        const res = await api.get("/dictation/phrases");
        this.phrases = res.data?.phrases || [];
        this.error = null;
        return {};
      } catch (err) {
        this.error = errorMessage(err, "The phrases could not be loaded.");
        return { error: this.error };
      } finally {
        this.loading = false;
      }
    },
    async add(
      input: DictationPhraseInput,
    ): Promise<{ phrase?: DictationPhrase; error?: string }> {
      try {
        const res = await api.post("/dictation/phrases", input);
        const added = res.data?.phrase as DictationPhrase | undefined;
        if (added) {
          this.phrases = [...this.phrases, added];
        }
        this.error = null;
        return { phrase: added };
      } catch (err) {
        const message = errorMessage(err, "The phrase could not be added.");
        this.error = message;
        return { error: message };
      }
    },
    async update(
      id: string,
      input: DictationPhraseInput,
    ): Promise<{ phrase?: DictationPhrase; error?: string }> {
      try {
        const res = await api.put(`/dictation/phrases/${id}`, input);
        const updated = res.data?.phrase as DictationPhrase | undefined;
        if (updated) {
          this.phrases = this.phrases.map((phrase) =>
            phrase.id === id ? updated : phrase,
          );
        }
        this.error = null;
        return { phrase: updated };
      } catch (err) {
        const message = errorMessage(err, "The phrase could not be updated.");
        this.error = message;
        return { error: message };
      }
    },
    async remove(id: string): Promise<{ error?: string }> {
      try {
        await api.delete(`/dictation/phrases/${id}`);
        this.phrases = this.phrases.filter((phrase) => phrase.id !== id);
        this.error = null;
        return {};
      } catch (err) {
        const message = errorMessage(err, "The phrase could not be removed.");
        this.error = message;
        return { error: message };
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useDictationPhrasesStore, import.meta.hot),
  );
}
