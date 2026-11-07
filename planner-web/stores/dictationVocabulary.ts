import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface DictationVocabularyTerm {
  id: string;
  term: string;
  projectId: string | null;
  dateCreated: string;
}

function errorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { error?: string } } })
    ?.response?.data?.error;
  return message || fallback;
}

/**
 * Per-user custom vocabulary. Terms belong to the caller; `projectId` null
 * means the personal scope. Every action returns its error instead of
 * throwing so callers can render inline feedback.
 */
export const useDictationVocabularyStore = defineStore("dictationVocabulary", {
  state: () => ({
    terms: [] as DictationVocabularyTerm[],
    loading: false,
    error: null as string | null,
  }),

  getters: {
    count: (state) => state.terms.length,
    termsFor:
      (state) =>
      (projectId: string | null): DictationVocabularyTerm[] =>
        state.terms.filter(
          (term) => (term.projectId ?? null) === (projectId ?? null),
        ),
  },

  actions: {
    async fetchAll(): Promise<{ error?: string }> {
      this.loading = true;
      try {
        const res = await api.get("/dictation/vocabulary");
        this.terms = res.data?.terms || [];
        this.error = null;
        return {};
      } catch (err) {
        this.error = errorMessage(
          err,
          "The vocabulary could not be loaded.",
        );
        return { error: this.error };
      } finally {
        this.loading = false;
      }
    },
    async add(
      term: string,
      projectId: string | null = null,
    ): Promise<{ term?: DictationVocabularyTerm; error?: string }> {
      try {
        const res = await api.post("/dictation/vocabulary", {
          term,
          projectId,
        });
        const added = res.data?.term as DictationVocabularyTerm | undefined;
        if (added) {
          this.terms = [...this.terms, added];
        }
        this.error = null;
        return { term: added };
      } catch (err) {
        const message = errorMessage(
          err,
          "The term could not be added to the vocabulary.",
        );
        this.error = message;
        return { error: message };
      }
    },
    async remove(id: string): Promise<{ error?: string }> {
      try {
        await api.delete(`/dictation/vocabulary/${id}`);
        this.terms = this.terms.filter((term) => term.id !== id);
        this.error = null;
        return {};
      } catch (err) {
        const message = errorMessage(
          err,
          "The term could not be removed from the vocabulary.",
        );
        this.error = message;
        return { error: message };
      }
    },
    async replaceScope(
      projectId: string | null,
      terms: string[],
    ): Promise<{ terms?: DictationVocabularyTerm[]; error?: string }> {
      try {
        const res = await api.put("/dictation/vocabulary", {
          projectId: projectId ?? null,
          terms,
        });
        const scope = (res.data?.terms || []) as DictationVocabularyTerm[];
        this.terms = [
          ...this.terms.filter(
            (term) => (term.projectId ?? null) !== (projectId ?? null),
          ),
          ...scope,
        ];
        this.error = null;
        return { terms: scope };
      } catch (err) {
        const message = errorMessage(
          err,
          "The vocabulary could not be imported.",
        );
        this.error = message;
        return { error: message };
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useDictationVocabularyStore, import.meta.hot),
  );
}
