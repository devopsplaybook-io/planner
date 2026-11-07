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

function makeDictationStore() {
  const store = reactive({
    status: "done" as string | null,
    stage: "actions" as string | null,
    isProcessing: false,
    hasRawTranscript: true,
    hasPolishedText: true,
    jobId: "job-1" as string | null,
    engineState: "ready",
    language: "auto",
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
    submitAudio: vi.fn(async () => undefined),
    poll: vi.fn(async () => true),
    openJob: vi.fn(async () => undefined),
    fetchRecentJobs: vi.fn(async () => undefined),
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

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

async function openDialog() {
  const wrapper = mount(DictationDialog, {
    props: { open: false },
    global: {
      components: { ProjectSelect: defineComponent({ render: () => null }) },
    },
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  tasksStore.create.mockReset();
  notesStore.create.mockReset();
  dictationStore = makeDictationStore();
  recommendationStore = {
    config: {},
    isDictationEnabled: true,
    isImproveEnabled: true,
    dictationMaxDurationSeconds: 300,
    dictationMaxUploadMb: 10,
    dictationLanguages: ["auto", "en", "fr"],
    dictationDefaultLanguage: "auto",
    dictationEstimatedRtf: 0.5,
    dictationEngineState: "ready",
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
