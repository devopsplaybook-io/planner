import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "../Config";
import {
  DbUtilsClose,
  DbUtilsInit,
  DbUtilsInitGetDatabase,
} from "../utils/DbUtils";
import {
  DictationDataCreate,
  DictationDataCountUnreadSince,
  DictationDataDelete,
  DictationDataDeleteExpired,
  DictationDataGet,
  DictationDataGetByClientId,
  DictationDataGetForUser,
  DictationDataGetInFlightForUser,
  DictationDataGetLatestByAttachment,
  DictationDataListInbox,
  DictationDataListKeptAudio,
  DictationDataListRecent,
  DictationDataListResumable,
  DictationDataListResumableMeeting,
  DictationDataMarkConverted,
  DictationDataMarkInterruptedBeforeStt,
  DictationDataSetArchived,
  DictationDataSetAudioState,
  DictationDataSetSummaryResult,
  DictationDataUpdate,
  DictationDataUpdateProgress,
} from "./DictationData";

describe("DictationData (sqlite)", () => {
  let dataDir: string;

  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  function createInput(overrides: Record<string, unknown> = {}) {
    return {
      id: `job-${Math.random().toString(36).slice(2)}`,
      userId: "user-1",
      source: "dictation" as const,
      status: "processing" as const,
      stage: "transcribing",
      language: "en",
      engine: "external",
      model: "whisper-test",
      expiresAt: future(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dictation-data-"));
    const config = new Config();
    config.DATABASE_TYPE = "sqlite";
    config.DATA_DIR = dataDir;
    await DbUtilsInit(config);
    const db = DbUtilsInitGetDatabase();
    db.exec(`
      CREATE TABLE users (id VARCHAR(50) PRIMARY KEY);
      CREATE TABLE tasks (id VARCHAR(50) PRIMARY KEY);
      CREATE TABLE projects (id VARCHAR(50) PRIMARY KEY);
    `);
    db.exec(
      await fs.readFile(
        path.join(__dirname, "..", "..", "sql", "sqlite", "init-0026.sql"),
        "utf-8",
      ),
    );
    db.exec(
      await fs.readFile(
        path.join(__dirname, "..", "..", "sql", "sqlite", "init-0027.sql"),
        "utf-8",
      ),
    );
    db.exec(
      await fs.readFile(
        path.join(__dirname, "..", "..", "sql", "sqlite", "init-0029.sql"),
        "utf-8",
      ),
    );
  });

  beforeEach(async () => {
    const db = DbUtilsInitGetDatabase();
    db.exec("DELETE FROM dictation_jobs; DELETE FROM users; DELETE FROM tasks;");
    db.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2');");
    db.exec("INSERT INTO tasks (id) VALUES ('task-1');");
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dataDir);
  });

  it("should create and read a job with its defaults", async () => {
    await DictationDataCreate(createInput({ id: "job-1" }));

    const job = await DictationDataGet("job-1");
    expect(job).toMatchObject({
      id: "job-1",
      userId: "user-1",
      source: "dictation",
      status: "processing",
      stage: "transcribing",
      language: "en",
      engine: "external",
      model: "whisper-test",
      rawTranscript: null,
      polishedText: null,
      polished: false,
      actions: [],
      actionsAvailable: false,
      error: null,
      revision: 0,
    });
    expect(job?.dateCreated).toBeDefined();
    expect(await DictationDataGet("missing")).toBeNull();
  });

  it("should persist the translation target and confidence segments", async () => {
    const segments = [
      { text: "hello", fromMs: 0, toMs: 500, confidence: 0.9 },
      { text: "world", fromMs: 500, toMs: 900, confidence: null },
    ];
    await DictationDataCreate(
      createInput({ id: "job-1", targetLanguage: "fr" }),
    );
    await DictationDataUpdate("job-1", { segments });

    const job = await DictationDataGet("job-1");
    expect(job?.targetLanguage).toBe("fr");
    expect(job?.segments).toEqual(segments);

    await DictationDataUpdate("job-1", {
      targetLanguage: null,
      segments: null,
    });
    const updated = await DictationDataGet("job-1");
    expect(updated?.targetLanguage).toBeNull();
    expect(updated?.segments).toBeNull();
  });

  it("should degrade malformed stored segments to null", async () => {
    await DictationDataCreate(createInput({ id: "job-1" }));
    DbUtilsInitGetDatabase().exec(
      "UPDATE dictation_jobs SET segments = 'not json' WHERE id = 'job-1'",
    );
    expect((await DictationDataGet("job-1"))?.segments).toBeNull();
  });

  it("should never return another user's job", async () => {
    await DictationDataCreate(createInput({ id: "job-1", userId: "user-1" }));

    expect(await DictationDataGetForUser("user-1", "job-1")).not.toBeNull();
    expect(await DictationDataGetForUser("user-2", "job-1")).toBeNull();
  });

  it("should patch fields, persist actions and bump the revision", async () => {
    await DictationDataCreate(createInput({ id: "job-1" }));

    await DictationDataUpdate("job-1", {
      rawTranscript: "hello",
      polishedText: "Hello!",
      polished: true,
      actions: [
        {
          type: "create_task",
          title: "Greet",
          description: "Say hi",
          priority: "high",
        },
      ],
      actionsAvailable: true,
      stage: "actions",
      sttMs: 12.7,
    });

    let job = await DictationDataGet("job-1");
    expect(job).toMatchObject({
      rawTranscript: "hello",
      polishedText: "Hello!",
      polished: true,
      actionsAvailable: true,
      stage: "actions",
      revision: 1,
    });
    expect(job?.actions).toEqual([
      {
        type: "create_task",
        title: "Greet",
        description: "Say hi",
        priority: "high",
      },
    ]);
    expect(job?.sttMs).toBeCloseTo(12.7);

    await DictationDataUpdate("job-1", { status: "done", stage: null });
    job = await DictationDataGet("job-1");
    expect(job).toMatchObject({ status: "done", stage: null, revision: 2 });
    // Fields not in the patch are preserved
    expect(job?.rawTranscript).toBe("hello");
  });

  it("should ignore an empty patch", async () => {
    await DictationDataCreate(createInput({ id: "job-1" }));
    await DictationDataUpdate("job-1", {});
    expect((await DictationDataGet("job-1"))?.revision).toBe(0);
  });

  it("should find the processing job of a user for a source", async () => {
    await DictationDataCreate(
      createInput({ id: "job-done", status: "done", stage: null }),
    );
    await DictationDataCreate(createInput({ id: "job-voice", source: "voice_comment" }));
    await DictationDataCreate(createInput({ id: "job-dictation" }));

    expect(await DictationDataGetInFlightForUser("user-1", "dictation")).toMatchObject({
      id: "job-dictation",
    });
    expect(
      await DictationDataGetInFlightForUser("user-1", "voice_comment"),
    ).toMatchObject({ id: "job-voice" });
    expect(await DictationDataGetInFlightForUser("user-2", "dictation")).toBeNull();
  });

  it("should list recent non-expired jobs newest first, bounded and filtered", async () => {
    await DictationDataCreate(
      createInput({ id: "job-old", expiresAt: past() }),
    );
    await DictationDataCreate(createInput({ id: "job-voice", source: "voice_comment" }));
    await new Promise((resolve) => setTimeout(resolve, 3));
    await DictationDataCreate(createInput({ id: "job-new" }));

    const all = await DictationDataListRecent("user-1", undefined, 10);
    expect(all.map((job) => job.id)).toEqual(["job-new", "job-voice"]);

    const dictation = await DictationDataListRecent("user-1", "dictation", 10);
    expect(dictation.map((job) => job.id)).toEqual(["job-new"]);

    const limited = await DictationDataListRecent("user-1", undefined, 1);
    expect(limited).toHaveLength(1);
    expect(await DictationDataListRecent("user-2")).toEqual([]);
  });

  it("should delete only expired jobs", async () => {
    await DictationDataCreate(createInput({ id: "job-expired", expiresAt: past() }));
    await DictationDataCreate(createInput({ id: "job-live" }));

    await expect(DictationDataDeleteExpired()).resolves.toBe(1);
    expect(await DictationDataGet("job-expired")).toBeNull();
    expect(await DictationDataGet("job-live")).not.toBeNull();
  });

  it("should mark only pre-STT processing jobs as interrupted", async () => {
    await DictationDataCreate(createInput({ id: "job-transcribing" }));
    await DictationDataCreate(createInput({ id: "job-polishing", stage: "polishing" }));
    await DictationDataUpdate("job-polishing", { rawTranscript: "hello" });
    await DictationDataCreate(
      createInput({ id: "job-done", status: "done", stage: null }),
    );

    await expect(
      DictationDataMarkInterruptedBeforeStt("Interrupted, please record again."),
    ).resolves.toBe(1);

    expect(await DictationDataGet("job-transcribing")).toMatchObject({
      status: "error",
      stage: null,
      error: "Interrupted, please record again.",
      revision: 1,
    });
    expect(await DictationDataGet("job-polishing")).toMatchObject({
      status: "processing",
      rawTranscript: "hello",
    });
    expect((await DictationDataGet("job-done"))?.status).toBe("done");
  });

  it("should list the processing jobs that can resume after STT", async () => {
    await DictationDataCreate(createInput({ id: "job-raw" }));
    await DictationDataUpdate("job-raw", { rawTranscript: "hello" });
    await DictationDataCreate(createInput({ id: "job-no-raw" }));

    const resumable = await DictationDataListResumable();
    expect(resumable.map((job) => job.id)).toEqual(["job-raw"]);
  });

  it("should return the latest job of an attachment", async () => {
    await DictationDataCreate(
      createInput({
        id: "job-first",
        source: "voice_comment",
        attachmentId: "att-1",
        status: "error",
        stage: null,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 3));
    await DictationDataCreate(
      createInput({
        id: "job-second",
        source: "voice_comment",
        attachmentId: "att-1",
      }),
    );

    expect(await DictationDataGetLatestByAttachment("att-1")).toMatchObject({
      id: "job-second",
    });
    expect(await DictationDataGetLatestByAttachment("att-2")).toBeNull();
  });

  it("should reject a second processing job for the same attachment", async () => {
    await DictationDataCreate(
      createInput({
        id: "job-first",
        source: "voice_comment",
        attachmentId: "att-1",
      }),
    );
    await expect(
      DictationDataCreate(
        createInput({
          id: "job-second",
          source: "voice_comment",
          attachmentId: "att-1",
        }),
      ),
    ).rejects.toBeTruthy();
    // A settled job no longer blocks the attachment
    await DictationDataUpdate("job-first", { status: "done", stage: null });
    await expect(
      DictationDataCreate(
        createInput({
          id: "job-second",
          source: "voice_comment",
          attachmentId: "att-1",
        }),
      ),
    ).resolves.toBeUndefined();
    expect((await DictationDataGet("job-second"))?.status).toBe("processing");
  });

  it("should persist inbox and meeting fields with defaults", async () => {
    await DictationDataCreate(
      createInput({
        id: "job-meeting",
        source: "import",
        jobKind: "meeting",
        clientId: "client-1",
        projectId: "project-1",
        stage: "queued",
        audioPath: "/tmp/audio.wav",
        audioRetained: true,
      }),
    );

    const job = await DictationDataGet("job-meeting");
    expect(job).toMatchObject({
      source: "import",
      jobKind: "meeting",
      clientId: "client-1",
      projectId: "project-1",
      audioPath: "/tmp/audio.wav",
      audioRetained: true,
      archivedAt: null,
      transcriptSegments: null,
      summary: null,
      decisions: [],
      chunkPlan: null,
      segmentsDone: 0,
      segmentsTotal: 0,
      convertedAt: null,
    });
    expect(await DictationDataGetByClientId("user-1", "client-1")).toMatchObject({
      id: "job-meeting",
    });
    expect(
      await DictationDataGetByClientId("user-2", "client-1"),
    ).toBeNull();
  });

  it("should reject a duplicate clientId per user", async () => {
    await DictationDataCreate(createInput({ id: "job-1", clientId: "dup" }));
    await expect(
      DictationDataCreate(createInput({ id: "job-2", clientId: "dup" })),
    ).rejects.toBeTruthy();
  });

  it("should archive, list and count inbox entries", async () => {
    await DictationDataCreate(
      createInput({ id: "job-open", source: "quick_capture" }),
    );
    await DictationDataCreate(
      createInput({ id: "job-done", status: "done", stage: null }),
    );
    await DictationDataCreate(
      createInput({
        id: "job-voice",
        source: "voice_comment",
        status: "done",
        stage: null,
      }),
    );
    await DictationDataSetArchived(
      "job-done",
      "user-1",
      new Date().toISOString(),
    );

    const visible = await DictationDataListInbox("user-1", { limit: 10 });
    expect(visible.total).toBe(1);
    expect(visible.jobs.map((job) => job.id)).toEqual(["job-open"]);

    const withArchived = await DictationDataListInbox("user-1", {
      limit: 10,
      includeArchived: true,
    });
    expect(withArchived.total).toBe(2);

    const page = await DictationDataListInbox("user-1", {
      limit: 1,
      offset: 1,
      includeArchived: true,
    });
    expect(page.jobs).toHaveLength(1);

    const counts = await DictationDataCountUnreadSince(
      "user-1",
      new Date(0).toISOString(),
    );
    expect(counts).toEqual({ unread: 0, processing: 1 });
  });

  it("should persist progress, transcript segments and the summary", async () => {
    await DictationDataCreate(
      createInput({ id: "job-meeting", source: "import", jobKind: "meeting" }),
    );

    await DictationDataUpdateProgress("job-meeting", {
      segmentsDone: 2,
      segmentsTotal: 4,
      transcriptSegments: [
        { fromMs: 0, toMs: 1000, text: "hello" },
        { fromMs: 1000, toMs: 2000, text: "world" },
      ],
      stage: "transcribing",
    });

    let job = await DictationDataGet("job-meeting");
    expect(job).toMatchObject({
      segmentsDone: 2,
      segmentsTotal: 4,
      stage: "transcribing",
      revision: 1,
    });
    expect(job?.transcriptSegments).toHaveLength(2);

    await DictationDataSetSummaryResult("job-meeting", {
      summary: "A short meeting",
      decisions: ["Ship it"],
      actions: [{ type: "create_task", title: "Ship", description: "" }],
    });
    job = await DictationDataGet("job-meeting");
    expect(job?.summary).toBe("A short meeting");
    expect(job?.decisions).toEqual(["Ship it"]);
    expect(job?.actionsAvailable).toBe(true);

    await expect(
      DictationDataListResumableMeeting(),
    ).resolves.toMatchObject([{ id: "job-meeting" }]);
    await DictationDataMarkConverted("job-meeting", "task", "task-9");
    expect((await DictationDataGet("job-meeting"))?.convertedTargetId).toBe(
      "task-9",
    );
  });

  it("should track kept audio and delete a settled job", async () => {
    await DictationDataCreate(
      createInput({
        id: "job-audio",
        status: "done",
        stage: null,
        audioPath: "/data/a.wav",
        audioRetained: true,
      }),
    );
    await DictationDataCreate(
      createInput({ id: "job-b", source: "import", jobKind: "meeting" }),
    );

    expect(
      (await DictationDataListKeptAudio("user-1")).map((job) => job.id),
    ).toEqual(["job-audio"]);

    await DictationDataSetAudioState("job-audio", {
      audioPath: null,
      audioDeletedAt: new Date().toISOString(),
    });
    expect((await DictationDataGet("job-audio"))?.audioPath).toBeNull();

    await expect(DictationDataDelete("job-b", "user-1")).resolves.toBe(1);
    expect(await DictationDataGet("job-b")).toBeNull();
    await expect(DictationDataDelete("job-b", "user-1")).resolves.toBe(0);
  });
});
