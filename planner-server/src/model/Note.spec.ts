import { Note, NoteComment } from "../model/Note";

describe("Note model", () => {
  describe("constructor", () => {
    it("should set default values", () => {
      const note = new Note();
      expect(note.id).toBeDefined();
      expect(note.description).toBe("");
      expect(note.comments).toEqual([]);
      expect(note.attachments).toEqual([]);
      expect(note.labels).toEqual([]);
      expect(note.dateCreated).toBeDefined();
      expect(note.dateUpdated).toBeDefined();
    });
  });

  describe("fromJson", () => {
    it("should create a Note from valid JSON", () => {
      const note = Note.fromJson({
        id: "note-1",
        projectId: "proj-1",
        title: "Meeting notes",
        description: "Discussed roadmap",
      });
      expect(note.id).toBe("note-1");
      expect(note.projectId).toBe("proj-1");
      expect(note.title).toBe("Meeting notes");
      expect(note.description).toBe("Discussed roadmap");
    });

    it("should default description when missing", () => {
      const note = Note.fromJson({
        projectId: "p1",
        title: "Minimal",
      });
      expect(note.description).toBe("");
    });

    it("should return null for null input", () => {
      expect(Note.fromJson(null)).toBeNull();
    });

    it("should parse comments and labels when provided", () => {
      const comment: NoteComment = {
        id: "c1",
        userId: "u1",
        text: "Great note",
        dateCreated: "2026-01-01",
      };
      const note = Note.fromJson({
        projectId: "p1",
        title: "Complex",
        comments: [comment],
        labels: ["reference", "important"],
      });
      expect(note.comments).toHaveLength(1);
      expect(note.comments[0].text).toBe("Great note");
      expect(note.labels).toEqual(["reference", "important"]);
    });
  });

  describe("toJson", () => {
    it("should include core fields without comments/attachments/labels", () => {
      const note = new Note();
      note.projectId = "p1";
      note.title = "Test";
      note.description = "desc";

      const json = note.toJson();
      expect(json.id).toBe(note.id);
      expect(json.projectId).toBe("p1");
      expect(json.title).toBe("Test");
      expect(json.description).toBe("desc");
      expect(json.dateCreated).toBe(note.dateCreated);
      expect(json.dateUpdated).toBe(note.dateUpdated);
      expect(json.comments).toBeUndefined();
      expect(json.labels).toBeUndefined();
    });
  });

  describe("toTransportJson", () => {
    it("should include comments, attachments, and labels as arrays", () => {
      const note = new Note();
      note.projectId = "p1";
      note.title = "Transport";
      note.comments = [
        { id: "c1", userId: "u1", text: "hey", dateCreated: "2026-01-01" },
      ];
      note.labels = ["tag1"];

      const json = note.toTransportJson();
      expect(json.comments).toEqual(note.comments);
      expect(json.labels).toEqual(note.labels);
      expect(json.attachments).toEqual([]);
    });
  });
});
