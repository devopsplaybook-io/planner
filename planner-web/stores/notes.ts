// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";

export interface NoteComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
}

export interface Note {
  id: string;
  projectId: string;
  title: string;
  description: string;
  comments: NoteComment[];
  attachments: unknown[];
  labels: string[];
  dateCreated: string;
  dateUpdated: string;
}

export const useNotesStore = defineStore("notes", {
  state: () => ({
    notes: [] as Note[],
    currentNote: null as Note | null,
  }),

  actions: {
    async fetchAll(projectId?: string) {
      const params = projectId ? { projectId } : {};
      const res = await api.get("/notes", { params });
      this.notes = res.data;
    },

    async fetchById(id: string) {
      const res = await api.get(`/notes/${id}`);
      this.currentNote = res.data;
      return res.data;
    },

    async create(data: {
      projectId: string;
      title: string;
      description?: string;
      labels?: string[];
    }) {
      const res = await api.post("/notes", data);
      this.notes.push(res.data);
      return res.data;
    },

    async update(id: string, data: Partial<Note>) {
      const res = await api.put(`/notes/${id}`, data);
      const index = this.notes.findIndex((n) => n.id === id);
      if (index >= 0) {
        this.notes[index] = res.data;
      }
      if (this.currentNote?.id === id) {
        this.currentNote = res.data;
      }
      return res.data;
    },

    async remove(id: string) {
      await api.delete(`/notes/${id}`);
      this.notes = this.notes.filter((n) => n.id !== id);
      if (this.currentNote?.id === id) {
        this.currentNote = null;
      }
    },

    async addComment(noteId: string, text: string) {
      const res = await api.post(`/notes/${noteId}/comments`, { text });
      const noteIdx = this.notes.findIndex((n) => n.id === noteId);
      if (noteIdx >= 0) {
        this.notes[noteIdx].comments.push(res.data);
      }
      if (this.currentNote?.id === noteId) {
        this.currentNote.comments.push(res.data);
      }
      return res.data;
    },

    async deleteComment(noteId: string, commentId: string) {
      await api.delete(`/notes/${noteId}/comments/${commentId}`);
      const note = this.notes.find((n) => n.id === noteId);
      if (note) {
        note.comments = note.comments.filter((c) => c.id !== commentId);
      }
      if (this.currentNote?.id === noteId) {
        this.currentNote.comments = this.currentNote.comments.filter(
          (c) => c.id !== commentId,
        );
      }
    },

    async setLabels(noteId: string, labels: string[]) {
      await api.post(`/notes/${noteId}/labels`, { labels });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useNotesStore, import.meta.hot));
}
