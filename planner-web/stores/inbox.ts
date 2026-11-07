import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import type { DictationJobView } from "./dictation";

export type InboxStatus = "processing" | "done" | "error";
export type InboxSource = "dictation" | "inline" | "quick_capture" | "import";

export interface InboxItem {
  id: string;
  source: string;
  jobKind: string;
  status: InboxStatus;
  stage: string | null;
  preview: string;
  language: string | null;
  audioDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  convertedType: string | null;
  convertedTargetId: string | null;
  progress: { segmentsDone: number; segmentsTotal: number; percent: number };
  error: "failed" | null;
}

export interface InboxFilter {
  status: InboxStatus | null;
  source: InboxSource | null;
  includeArchived: boolean;
}

export type InboxConvertTarget = "task" | "note" | "comment" | "checklist";

const SEEN_KEY = "dictation-inbox-seen-at";
const PAGE_SIZE = 20;

function loadSeenAt(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

export const useInboxStore = defineStore("inbox", {
  state: () => ({
    items: [] as InboxItem[],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: "",
    filter: {
      status: null,
      source: null,
      includeArchived: false,
    } as InboxFilter,
    badge: { unread: 0, processing: 0 },
    // Timestamp of the last time the user looked at the inbox
    seenAt: loadSeenAt(),
    detail: null as DictationJobView | null,
    detailLoading: false,
  }),

  getters: {
    badgeCount: (state) => state.badge.unread,
    activeCount: (state) => state.badge.unread + state.badge.processing,
    isEmpty: (state) => !state.loading && state.items.length === 0,
  },

  actions: {
    async fetchPage(reset = true): Promise<void> {
      if (reset) {
        this.loading = true;
      } else {
        this.loadingMore = true;
      }
      this.error = "";
      const offset = reset ? 0 : this.items.length;
      try {
        const params: Record<string, string | number> = {
          limit: PAGE_SIZE,
          offset,
        };
        if (this.filter.status) params.status = this.filter.status;
        if (this.filter.source) params.source = this.filter.source;
        if (this.filter.includeArchived) params.includeArchived = "1";
        const res = await api.get("/dictation/inbox", { params });
        const page = res.data?.items || [];
        this.items = reset ? page : [...this.items, ...page];
        this.total = res.data?.total || 0;
        this.hasMore = !!res.data?.hasMore;
      } catch (err) {
        this.error =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error || "The inbox could not be loaded.";
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },

    async loadMore(): Promise<void> {
      if (!this.hasMore || this.loadingMore) {
        return;
      }
      await this.fetchPage(false);
    },

    async setFilter(patch: Partial<InboxFilter>): Promise<void> {
      this.filter = { ...this.filter, ...patch };
      await this.fetchPage(true);
    },

    /** Badge counts are unread settlements since the user last looked. */
    async fetchBadge(): Promise<void> {
      try {
        const res = await api.get("/dictation/inbox/badge", {
          params: this.seenAt ? { since: this.seenAt } : undefined,
        });
        this.badge = {
          unread: res.data?.unread || 0,
          processing: res.data?.processing || 0,
        };
      } catch {
        // The badge is an enhancement: keep the previous counts
      }
    },

    markSeen(): void {
      const now = new Date().toISOString();
      this.seenAt = now;
      this.badge = { ...this.badge, unread: 0 };
      try {
        localStorage.setItem(SEEN_KEY, now);
      } catch {
        // Storage unavailable: the badge is cleared for this session only
      }
    },

    async archive(jobId: string, archived: boolean): Promise<{ error?: string }> {
      try {
        await api.patch(`/dictation/inbox/${jobId}`, { archived });
        this.items = this.items.map((item) =>
          item.id === jobId
            ? {
                ...item,
                archivedAt: archived ? new Date().toISOString() : null,
              }
            : item,
        );
        if (!this.filter.includeArchived && archived) {
          this.items = this.items.filter((item) => item.id !== jobId);
          this.total = Math.max(0, this.total - 1);
        }
        await this.fetchBadge();
        return {};
      } catch (err) {
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response?.data
              ?.error || "The entry could not be archived.",
        };
      }
    },

    async remove(jobId: string): Promise<{ error?: string }> {
      try {
        await api.delete(`/dictation/inbox/${jobId}`);
        this.items = this.items.filter((item) => item.id !== jobId);
        this.total = Math.max(0, this.total - 1);
        await this.fetchBadge();
        return {};
      } catch (err) {
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response?.data
              ?.error || "The entry could not be deleted.",
        };
      }
    },

    async fetchDetail(jobId: string): Promise<DictationJobView | null> {
      this.detailLoading = true;
      try {
        const res = await api.get(`/dictation/${jobId}`);
        this.detail = res.data as DictationJobView;
        return this.detail;
      } catch {
        return null;
      } finally {
        this.detailLoading = false;
      }
    },

    async convert(
      jobId: string,
      payload: {
        target: InboxConvertTarget;
        projectId?: string;
        taskId?: string;
        title?: string;
        text?: string;
      },
    ): Promise<{ error?: string; type?: string; targetId?: string }> {
      try {
        const res = await api.post(`/dictation/inbox/${jobId}/convert`, payload);
        this.items = this.items.map((item) =>
          item.id === jobId
            ? {
                ...item,
                convertedType: res.data?.type || payload.target,
                convertedTargetId: res.data?.targetId || null,
              }
            : item,
        );
        return res.data;
      } catch (err) {
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response?.data
              ?.error || "The dictation could not be converted.",
        };
      }
    },

    /** Uploads a long-form recording; the server answers 202 with a job id. */
    async importMeeting(
      form: FormData,
      onUploadProgress?: (percent: number) => void,
    ): Promise<{
      jobId?: string;
      conflictJobId?: string;
      error?: string;
    }> {
      try {
        const res = await api.post("/dictation/import", form, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 0,
          onUploadProgress: (event) => {
            if (!onUploadProgress) {
              return;
            }
            const total = event.total || 0;
            if (total > 0) {
              onUploadProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
            }
          },
        });
        return { jobId: res.data?.jobId };
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const conflictJobId = (
          err as { response?: { data?: { jobId?: string } } }
        )?.response?.data?.jobId;
        if (status === 409 && conflictJobId) {
          return { conflictJobId };
        }
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response?.data
              ?.error || "The recording could not be imported.",
        };
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useInboxStore, import.meta.hot));
}