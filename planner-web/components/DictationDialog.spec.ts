// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  computed,
  defineComponent,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";

import DictationDialog from "./DictationDialog.vue";
import DictationActionCard from "./DictationActionCard.vue";
import DictationAskPanel from "./DictationAskPanel.vue";
import DictationConfidenceReview from "./DictationConfidenceReview.vue";
import DictationDiff from "./DictationDiff.vue";

const hoisted = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  isRecording: null as { value: boolean } | null,
  elapsedSeconds: null as { value: number } | null,
  stop: null as ReturnType<typeof vi.fn> | null,
}));

vi.mock("../composables/useDictation", async () => {
  const { ref } = await import("vue");
  const isRecording = ref(false);
  const elapsedSeconds = ref(0);
  const stop = vi.fn();
  hoisted.isRecording = isRecording;
  hoisted.elapsedSeconds = elapsedSeconds;
  hoisted.stop = stop;
  return {
    useDictation: (options: Record<string, unknown>) => {
      hoisted.options = options;
      return {
        isRecording,
        elapsedSeconds,
        level: ref(0),
        error: ref(""),
        start: vi.fn(),
        stop,
        cancel: vi.fn(),
      };
    },
  };
});

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("watch", watch);
vi.stubGlobal("onUnmounted", onUnmounted);
vi.stubGlobal("useModalDialog", () => ref(null));

let dictationStore: ReturnType<typeof makeDictationStore>;
let recommendationStore: Record<string, unknown>;
const projectsStore = {
  defaultProject: { id: "p1", archived: false },
  activeProjects: [{ id: "p1", archived: false }],
  projects: [{ id: "p1", statuses: ["To Do", "Done"] }],
  fetchAll: vi.fn().mockResolvedValue(undefined),
};
const tasksStore = { create: vi.fn() };
const notesStore = { create: vi.fn() };
const statusesStore = {
  catalog: [],
  fetchAll: vi.fn().mockResolvedValue(undefined),
  colorFor: vi.fn().mockReturnValue("#000000"),
};
const vocabularyStore = {
  terms: [],
  add: vi.fn().mockResolvedValue({ term: { id: "term-1" } }),
};

function makeDictationStore() {
  const store = reactive({
    status: "done" as string | null,
    stage: "actions" as string | null,
    isProcessing: false,
    hasRawTranscript: true,
    hasPolishedText: true,
    jobId: "job-1" as string | null,
    engineState: "ready",
    engine: "embedded",
    language: "auto",
    dialogTab: "dictate" as "dictate" | "capture" | "import" | "inbox",
    jobTargetLanguage: null as string | null,
    availability: {
      rawTranscript: true,
      polishedText: true,
      actions: true,
    } as { rawTranscript: boolean; polishedText: boolean; actions: boolean } | null,
    timings: null as Record<string, number | null> | null,
    result: {
      polishedText: "Hello",
      polished: true,
      rawTranscript: "hello",
      actions: [{ type: "create_task", title: "Do it", description: "" }],
      actionsAvailable: true,
    } as Record<string, unknown> | null,
    recentJobs: [] as Record<string, unknown>[],
    previews: [] as Record<string, unknown>[],
    previewLoading: false,
    previewError: "",
    applyResults: [] as Record<string, unknown>[],
    appliedBatches: [] as Record<string, unknown>[],
    latestBatch: null as Record<string, unknown> | null,
    askAnswer: null as Record<string, unknown> | null,
    askLoading: false,
    askError: "",
    submitAudio: vi.fn(async () => undefined),
    poll: vi.fn(async () => true),
    openJob: vi.fn(async () => undefined),
    fetchRecentJobs: vi.fn(async () => undefined),
    fetchPreferences: vi.fn(async () => undefined),
    previewActions: vi.fn(async (_jobId: string) => ({})),
    applyActions: vi.fn(
      async (
        _jobId: string,
        _requestId: string,
        _selections: unknown[],
      ) => ({
        outcome: {
          requestId: "req-x",
          alreadyApplied: false,
          results: [] as Record<string, unknown>[],
        },
      }),
    ),
    undoActions: vi.fn(async (_jobId: string, _requestId: string) => ({
      outcome: { requestId: "req-x", results: [] as Record<string, unknown>[] },
    })),
    fetchAppliedActions: vi.fn(async (_jobId: string) => undefined),
    ask: vi.fn(async (_payload: unknown) => ({ answer: {} })),
    reset: vi.fn(),
    setLanguage: vi.fn((value: string) => {
      store.language = value;
    }),
  });
  return store;
}

vi.stubGlobal("useDictationStore", () => dictationStore);
vi.stubGlobal("useRecommendationStore", () => recommendationStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useTasksStore", () => tasksStore);
vi.stubGlobal("useNotesStore", () => notesStore);
vi.stubGlobal("useStatusesStore", () => statusesStore);
vi.stubGlobal("useDictationVocabularyStore", () => vocabularyStore);

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

async function openDialog() {
  const wrapper = mount(DictationDialog, {
    props: { open: false },
    global: {
      components: {
        ProjectSelect: defineComponent({ render: () => null }),
        InlineDictationButton: defineComponent({ render: () => null }),
        QuickCapturePanel: defineComponent({
          name: "QuickCapturePanel",
          template: '<div class="quick-capture-panel-stub" />',
        }),
        MeetingImportPanel: defineComponent({
          name: "MeetingImportPanel",
          template: '<div class="meeting-import-panel-stub" />',
        }),
        InboxPanel: defineComponent({
          name: "InboxPanel",
          template: '<div class="inbox-panel-stub" />',
        }),
        DictationActionCard,
        DictationAskPanel,
        DictationConfidenceReview,
        DictationDiff,
      },
    },
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  tasksStore.create.mockReset();
  notesStore.create.mockReset();
  vocabularyStore.add.mockReset().mockResolvedValue({ term: { id: "term-1" } });
  dictationStore = makeDictationStore();
  recommendationStore = {
    config: {},
    isDictationEnabled: true,
    isImproveEnabled: true,
    isDictationSttConfigured: true,
    dictationImportEnabled: true,
    dictationMaxDurationSeconds: 300,
    dictationMaxUploadMb: 10,
    dictationLanguages: ["auto", "en", "fr"],
    dictationDefaultLanguage: "auto",
    dictationEstimatedRtf: 0.5,
    dictationEngineState: "ready",
    dictationConfidenceThreshold: 0.6,
    dictationConfidenceAvailable: true,
    dictationTranslationLanguages: ["en", "fr"],
    fetchConfig: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DictationDialog review errors", () => {
  it("shows the dismissible banner and never alerts when creating items fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    tasksStore.create.mockRejectedValueOnce({
      response: { data: { error: "create boom" } },
    });
    const wrapper = await openDialog();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("create boom");
    expect(alertSpy).not.toHaveBeenCalled();

    await wrapper.find(".dialog-error-dismiss").trigger("click");
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });

  it("shows the dismissible banner and never alerts when saving as a note fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    notesStore.create.mockRejectedValueOnce({
      response: { data: { error: "note boom" } },
    });
    const wrapper = await openDialog();

    await findButton(wrapper, "Save as note")?.trigger("click");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("note boom");
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("DictationDialog progressive review", () => {
  function seedRawOnly() {
    dictationStore.status = "processing";
    dictationStore.stage = "polishing";
    dictationStore.isProcessing = true;
    dictationStore.hasRawTranscript = true;
    dictationStore.hasPolishedText = false;
    dictationStore.result = {
      rawTranscript: "hello raw",
      polishedText: null,
      polished: false,
      actions: [],
      actionsAvailable: false,
    };
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: false,
      actions: false,
    };
    // Stop the poll loop after the first iteration
    dictationStore.poll = vi.fn(async () => {
      dictationStore.isProcessing = false;
      return true;
    });
  }

  it("opens the review on the raw transcript before polish completes", async () => {
    seedRawOnly();
    const wrapper = await openDialog();

    expect(wrapper.find(".dictation-review").exists()).toBe(true);
    const textarea = wrapper.find(".dictation-review textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("hello raw");
    expect(wrapper.find(".review-progress").text()).toContain(
      "Improving text",
    );
  });

  it("patches in the polished text when the user has not edited", async () => {
    seedRawOnly();
    const wrapper = await openDialog();

    dictationStore.result = {
      ...dictationStore.result,
      polishedText: "Hello raw!",
      polished: true,
    };
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: false,
    };
    await flushPromises();

    const textarea = wrapper.find(".dictation-review textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("Hello raw!");
    expect(findButton(wrapper, "Use polished text")).toBeUndefined();
  });

  it("keeps user edits and offers the polished text instead", async () => {
    seedRawOnly();
    const wrapper = await openDialog();

    const textarea = wrapper.find(".dictation-review textarea");
    await textarea.setValue("my own edit");

    dictationStore.result = {
      ...dictationStore.result,
      polishedText: "Hello raw!",
      polished: true,
    };
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: false,
    };
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe("my own edit");
    const usePolished = findButton(wrapper, "Use polished text");
    expect(usePolished).toBeTruthy();
    await usePolished!.trigger("click");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("Hello raw!");
  });

  it("patches action proposals when they arrive", async () => {
    seedRawOnly();
    const wrapper = await openDialog();
    expect(wrapper.find(".action-cards").exists()).toBe(false);

    dictationStore.result = {
      ...dictationStore.result,
      actions: [
        { type: "create_task", title: "Buy milk", description: "" },
      ],
      actionsAvailable: true,
    };
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: false,
      actions: true,
    };
    await flushPromises();

    const cards = wrapper.findAll(".action-card");
    expect(cards).toHaveLength(1);
    expect((cards[0]!.find(".action-title").element as HTMLInputElement).value).toBe(
      "Buy milk",
    );
  });

  it("shows the stage timings from the job view", async () => {
    dictationStore.timings = {
      queueMs: 5,
      sttMs: 4200,
      polishMs: 1100,
      actionsMs: 900,
      totalMs: 6200,
      audioDurationMs: 9000,
    };
    const wrapper = await openDialog();

    const timings = wrapper.find(".stage-timings");
    expect(timings.text()).toContain("Transcribed in 4.2 s");
    expect(timings.text()).toContain("Improved in 1.1 s");
    expect(timings.text()).toContain("Actions in 0.9 s");
  });

  it("explains when action proposals are unavailable", async () => {
    dictationStore.result = {
      rawTranscript: "hello",
      polishedText: "Hello",
      polished: true,
      actions: [],
      actionsAvailable: false,
    };
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: false,
    };
    const wrapper = await openDialog();

    expect(wrapper.text()).toContain(
      "Action proposals are not available for this dictation",
    );
  });
});

describe("DictationDialog recording configuration", () => {
  function seedRecordMode() {
    dictationStore.status = null;
    dictationStore.stage = null;
    dictationStore.isProcessing = false;
    dictationStore.hasRawTranscript = false;
    dictationStore.jobId = null;
    dictationStore.result = null;
    dictationStore.availability = null;
  }

  it("passes the server-configured max duration to the recorder", async () => {
    seedRecordMode();
    await openDialog();

    const options = hoisted.options as {
      maxDurationSeconds: { value: number };
    };
    expect(options.maxDurationSeconds.value).toBe(300);
  });

  it("renders the configured language list and persists a change", async () => {
    seedRecordMode();
    const wrapper = await openDialog();

    const select = wrapper.find(".language-select select");
    const options = select.findAll("option");
    expect(options.map((option) => option.text())).toEqual([
      "Automatic detection",
      "English",
      "French",
    ]);

    await select.setValue("fr");
    expect(dictationStore.setLanguage).toHaveBeenCalledWith("fr");
  });

  it("shows the preparing engine state", async () => {
    seedRecordMode();
    (recommendationStore as { dictationEngineState: string }).dictationEngineState =
      "preparing";
    const wrapper = await openDialog();

    expect(wrapper.find(".engine-preparing").text()).toContain(
      "Preparing speech engine",
    );
  });

  it("shows a rough ETA while transcribing", async () => {
    seedRecordMode();
    const wrapper = await openDialog();

    // Simulate a 10 s recording: submitAudio keeps the job processing
    hoisted.elapsedSeconds!.value = 10;
    hoisted.isRecording!.value = true;
    hoisted.stop!.mockResolvedValue({
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
    });
    dictationStore.submitAudio.mockImplementation(async () => {
      dictationStore.jobId = "job-1";
      dictationStore.status = "processing";
      dictationStore.stage = "transcribing";
      dictationStore.isProcessing = true;
      dictationStore.hasRawTranscript = false;
      dictationStore.poll.mockImplementation(async () => {
        dictationStore.isProcessing = false;
        return true;
      });
    });

    await wrapper.find(".mic-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".eta-label").text()).toContain(
      "Estimated transcription time: about 5 s",
    );
  });

  it("lists recent dictations and opens a stored one", async () => {
    seedRecordMode();
    dictationStore.recentJobs = [
      {
        jobId: "job-old",
        status: "done",
        dateCreated: "2026-11-07T09:30:00.000Z",
        result: { rawTranscript: "older dictation" },
      },
    ];
    dictationStore.openJob.mockImplementation(async () => {
      dictationStore.jobId = "job-old";
      dictationStore.status = "done";
      dictationStore.stage = null;
      dictationStore.result = {
        rawTranscript: "older dictation",
        polishedText: "Older dictation.",
        polished: true,
        actions: [],
        actionsAvailable: false,
      };
      dictationStore.availability = {
        rawTranscript: true,
        polishedText: true,
        actions: true,
      };
      dictationStore.hasRawTranscript = true;
    });

    const wrapper = await openDialog();
    expect(wrapper.find(".recent-dictations").text()).toContain(
      "Recent dictations (1)",
    );

    await findButton(wrapper, "Open")?.trigger("click");
    await flushPromises();

    expect(dictationStore.openJob).toHaveBeenCalledWith("job-old");
    expect(wrapper.find(".dictation-review").exists()).toBe(true);
  });
});

describe("DictationDialog accuracy review", () => {
  function seedReview(overrides = {}) {
    dictationStore.status = "done";
    dictationStore.stage = null;
    dictationStore.isProcessing = false;
    dictationStore.hasRawTranscript = true;
    dictationStore.hasPolishedText = true;
    dictationStore.jobId = "job-1";
    dictationStore.engine = "embedded";
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: false,
    };
    dictationStore.result = {
      rawTranscript: "kubernets is great and kubernets is old",
      polishedText: "kubernets is great and kubernets is old",
      polished: true,
      actions: [],
      actionsAvailable: false,
      segments: [
        { text: "kubernets", fromMs: 0, toMs: 800, confidence: 0.3 },
      ],
      ...overrides,
    };
  }

  async function applyCorrection(
    wrapper: ReturnType<typeof mount>,
    value: string,
  ) {
    await wrapper.find(".confidence-span").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper
      .find('input[aria-label="Correction for kubernets"]')
      .setValue(value);
    await wrapper.find(".confidence-editor").trigger("submit");
    await flushPromises();
  }

  it("replaces only the first low-confidence occurrence and marks the text edited", async () => {
    seedReview();
    const wrapper = await openDialog();
    expect(wrapper.find(".text-badge").text()).toBe("Polished");

    await applyCorrection(wrapper, "kubernetes");

    const textarea = wrapper.find(".dictation-review textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "kubernetes is great and kubernets is old",
    );
    expect(wrapper.find(".text-badge").text()).toBe("Edited by you");
  });

  it("explains when the corrected word is not in the text", async () => {
    seedReview({ polishedText: "something else", rawTranscript: "kubernets" });
    const wrapper = await openDialog();

    await applyCorrection(wrapper, "kubernetes");

    const textarea = wrapper.find(".dictation-review textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "something else",
    );
    expect(wrapper.find(".confidence-notice").text()).toContain(
      "Could not find",
    );
  });

  it("adds a corrected word to the personal vocabulary", async () => {
    seedReview();
    const wrapper = await openDialog();

    await wrapper.find(".confidence-span").trigger("click");
    await wrapper.vm.$nextTick();
    const add = wrapper
      .findAll("button")
      .find((button) => button.text() === "Add to vocabulary");
    await add!.trigger("click");
    await flushPromises();

    expect(vocabularyStore.add).toHaveBeenCalledWith("kubernets", null);
    expect(wrapper.find(".confidence-notice").text()).toContain(
      "personal vocabulary",
    );
  });

  it("keeps a revert to raw when the polished text arrives later", async () => {
    seedReview({ polishedText: "Hello raw!", rawTranscript: "hello raw" });
    const wrapper = await openDialog();

    const textarea = wrapper.find(".dictation-review textarea");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("Hello raw!");

    await findButton(wrapper, "Revert to raw")!.trigger("click");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("hello raw");

    dictationStore.result = {
      ...dictationStore.result,
      polishedText: "Hello raw, improved.",
    };
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe("hello raw");
  });

  it("shows the raw-versus-current diff", async () => {
    seedReview({ polishedText: "Hello world.", rawTranscript: "hello wrld" });
    const wrapper = await openDialog();

    expect(wrapper.find(".transcript-diff").text()).toContain(
      "Compare with raw transcript",
    );
    expect(wrapper.find(".dictation-diff").exists()).toBe(true);
  });

  it("shows the translation badge of the job", async () => {
    dictationStore.jobTargetLanguage = "en";
    seedReview({ polishedText: "Hello", rawTranscript: "Bonjour" });
    const wrapper = await openDialog();

    const badge = wrapper.find(".text-badge.is-translation");
    expect(badge.text()).toContain("Translated to English");
  });

  it("explains the missing confidence on external jobs", async () => {
    seedReview({ segments: null });
    dictationStore.engine = "external";
    const wrapper = await openDialog();

    expect(wrapper.text()).toContain(
      "Word confidence is not available with the external engine.",
    );
    expect(wrapper.find(".confidence-review").exists()).toBe(false);
  });

  it("states the audio retention in record and review modes", async () => {
    dictationStore.status = null;
    dictationStore.stage = null;
    dictationStore.isProcessing = false;
    dictationStore.hasRawTranscript = false;
    dictationStore.jobId = null;
    dictationStore.result = null;
    dictationStore.availability = null;
    let wrapper = await openDialog();
    expect(wrapper.text()).toContain(
      "Audio is deleted right after transcription",
    );

    seedReview();
    wrapper = await openDialog();
    expect(wrapper.text()).toContain(
      "Audio is deleted right after transcription",
    );
  });
});

describe("DictationDialog structured actions", () => {
  function seedStructuredReview() {
    dictationStore.status = "done";
    dictationStore.stage = null;
    dictationStore.isProcessing = false;
    dictationStore.hasRawTranscript = true;
    dictationStore.hasPolishedText = true;
    dictationStore.jobId = "job-1";
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: true,
    };
    dictationStore.result = {
      rawTranscript: "buy milk and note the login bug",
      polishedText: "Buy milk and note the login bug",
      polished: true,
      actions: [
        { type: "create_task", title: "Buy milk", description: "" },
        { type: "append_to_task", target: "Login", text: "More" },
      ],
      actionsAvailable: true,
      segments: null,
    };
    (recommendationStore as Record<string, unknown>).dictationApplyActions = true;
    (recommendationStore as Record<string, unknown>).dictationAskEnabled = true;
  }

  function resolvedPreview(index = 0) {
    return {
      index,
      type: "create_task",
      action: { type: "create_task", title: "Buy milk", description: "" },
      status: "resolved",
      target: null,
      candidates: [],
      diff: [],
      resolvedProjectId: "p1",
      resolvedStatus: "To Do",
    };
  }

  function ambiguousPreview(index = 1) {
    return {
      index,
      type: "append_to_task",
      action: { type: "append_to_task", target: "Login", text: "More" },
      status: "ambiguous",
      target: null,
      candidates: [
        { kind: "task", id: "t1", label: "Login bug", projectName: "Planner" },
      ],
      diff: [],
      error: "Several tasks match this name",
    };
  }

  it("loads previews, selects resolved actions and applies them", async () => {
    seedStructuredReview();
    dictationStore.previewActions = vi.fn(async () => {
      dictationStore.previews = [resolvedPreview(), ambiguousPreview()];
      return {};
    });
    dictationStore.applyActions = vi.fn(async () => {
      dictationStore.applyResults = [
        { index: 0, type: "create_task", status: "applied", targetId: "t-9" },
      ];
      dictationStore.latestBatch = {
        requestId: "req-1",
        actions: [{ status: "applied", undoneAt: null }],
      };
      return {
        outcome: {
          requestId: "req-1",
          alreadyApplied: false,
          results: [
            {
              index: 0,
              type: "create_task",
              status: "applied",
              targetId: "t-9",
            },
          ],
        },
      };
    });

    const wrapper = await openDialog();

    expect(dictationStore.previewActions).toHaveBeenCalledWith("job-1");
    expect(wrapper.findAll(".action-card")).toHaveLength(2);
    expect(wrapper.find(".resolution-badge").text()).toBe("Ready");

    const apply = findButton(wrapper, "Apply action");
    expect(apply).toBeTruthy();
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(dictationStore.applyActions).toHaveBeenCalledTimes(1);
    const [jobId, requestId, selections] =
      dictationStore.applyActions.mock.calls[0]!;
    expect(jobId).toBe("job-1");
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBeGreaterThan(0);
    expect(selections).toEqual([{ index: 0 }]);

    expect(findButton(wrapper, "Done")).toBeTruthy();
    const undo = findButton(wrapper, "Undo applied actions");
    expect(undo).toBeTruthy();

    await undo!.trigger("click");
    await flushPromises();
    expect(dictationStore.undoActions).toHaveBeenCalledWith("job-1", "req-1");
  });

  it("lets the user pick an ambiguous match before applying", async () => {
    seedStructuredReview();
    dictationStore.previewActions = vi.fn(async () => {
      dictationStore.previews = [ambiguousPreview(0)];
      return {};
    });

    const wrapper = await openDialog();
    await wrapper.find(".action-candidates button").trigger("click");
    await flushPromises();

    const apply = findButton(wrapper, "Apply action");
    expect(apply).toBeTruthy();
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(dictationStore.applyActions).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      [{ index: 0, targetId: "t1" }],
    );
  });

  it("shows the preview error instead of actions", async () => {
    seedStructuredReview();
    dictationStore.previewActions = vi.fn(async () => {
      dictationStore.previewError = "The actions could not be previewed.";
      return { error: "The actions could not be previewed." };
    });

    const wrapper = await openDialog();

    expect(wrapper.text()).toContain("could not be previewed");
    expect(wrapper.findAll(".action-card")).toHaveLength(0);
  });
});

describe("DictationDialog ask", () => {
  function seedAskReview() {
    dictationStore.status = "done";
    dictationStore.stage = null;
    dictationStore.isProcessing = false;
    dictationStore.hasRawTranscript = true;
    dictationStore.jobId = "job-1";
    dictationStore.availability = {
      rawTranscript: true,
      polishedText: true,
      actions: false,
    };
    dictationStore.result = {
      rawTranscript: "hello",
      polishedText: "Hello",
      polished: true,
      actions: [],
      actionsAvailable: false,
      segments: null,
    };
    (recommendationStore as Record<string, unknown>).dictationApplyActions = true;
    (recommendationStore as Record<string, unknown>).dictationAskEnabled = true;
  }

  it("asks a read-only question from the Ask tab", async () => {
    seedAskReview();
    dictationStore.ask = vi.fn(async () => {
      dictationStore.askAnswer = {
        intent: "due_today",
        answer: "1 open task is due today.",
        items: [],
        truncated: false,
        generatedBy: "deterministic",
      };
      return { answer: dictationStore.askAnswer };
    });

    const wrapper = await openDialog();
    await findButton(wrapper, "Ask")!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".ask-panel").exists()).toBe(true);
    await wrapper.find(".ask-question textarea").setValue("What is due today?");
    await wrapper.find(".ask-form").trigger("submit");
    await flushPromises();

    expect(dictationStore.ask).toHaveBeenCalledWith("What is due today?", null);
    expect(wrapper.find(".ask-text").text()).toContain(
      "1 open task is due today.",
    );
    expect(wrapper.text()).toContain("Read-only");
  });

  it("hides the Ask tab when the server does not advertise it", async () => {
    seedAskReview();
    (recommendationStore as Record<string, unknown>).dictationAskEnabled = false;

    const wrapper = await openDialog();

    expect(wrapper.find(".review-tabs").exists()).toBe(false);
    expect(wrapper.find(".ask-panel").exists()).toBe(false);
  });
});

describe("DictationDialog consolidated menu", () => {
  function tabLabels(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll(".dictation-tab").map((tab) => tab.text());
  }

  it("renders Dictate, Capture, Import and Inbox as one tab strip", async () => {
    const wrapper = await openDialog();

    expect(wrapper.find(".dictation-tabs").exists()).toBe(true);
    expect(tabLabels(wrapper)).toEqual([
      "Dictate",
      "Capture",
      "Import",
      "Inbox",
    ]);
    expect(
      wrapper.findAll(".dictation-tab").map((tab) =>
        tab.attributes("aria-selected"),
      ),
    ).toEqual(["true", "false", "false", "false"]);
    expect(wrapper.find(".dictation-review").exists()).toBe(true);
  });

  it("switches between the dictate, capture, import and inbox panels", async () => {
    const wrapper = await openDialog();

    await findButton(wrapper, "Capture")!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".quick-capture-panel-stub").exists()).toBe(true);
    expect(wrapper.find(".dictation-review").exists()).toBe(false);

    await findButton(wrapper, "Import")!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".meeting-import-panel-stub").exists()).toBe(true);
    expect(wrapper.find(".quick-capture-panel-stub").exists()).toBe(false);

    await findButton(wrapper, "Inbox")!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".inbox-panel-stub").exists()).toBe(true);
    expect(wrapper.find(".meeting-import-panel-stub").exists()).toBe(false);

    await findButton(wrapper, "Dictate")!.trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".dictation-review").exists()).toBe(true);
    expect(wrapper.find(".inbox-panel-stub").exists()).toBe(false);
  });

  it("opens on the tab requested by the store", async () => {
    dictationStore.dialogTab = "capture";

    const wrapper = await openDialog();

    expect(wrapper.find(".quick-capture-panel-stub").exists()).toBe(true);
    expect(
      findButton(wrapper, "Capture")!.attributes("aria-selected"),
    ).toBe("true");
  });

  it("opens the inbox tab requested by a deep link", async () => {
    dictationStore.dialogTab = "inbox";

    const wrapper = await openDialog();

    expect(wrapper.find(".inbox-panel-stub").exists()).toBe(true);
    expect(
      findButton(wrapper, "Inbox")!.attributes("aria-selected"),
    ).toBe("true");
  });

  it("switches to the inbox tab while the menu is already open", async () => {
    const wrapper = await openDialog();
    expect(wrapper.find(".dictation-review").exists()).toBe(true);

    dictationStore.dialogTab = "inbox";
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".inbox-panel-stub").exists()).toBe(true);
  });

  it("opens on Import when speech-to-text is unavailable and keeps the inbox tab", async () => {
    (recommendationStore as Record<string, unknown>).isDictationSttConfigured =
      false;

    const wrapper = await openDialog();

    expect(tabLabels(wrapper)).toEqual(["Import", "Inbox"]);
    expect(wrapper.find(".meeting-import-panel-stub").exists()).toBe(true);
    expect(wrapper.find(".quick-capture-panel-stub").exists()).toBe(false);
  });
});
