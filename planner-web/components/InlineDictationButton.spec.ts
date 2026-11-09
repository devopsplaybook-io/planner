// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import InlineDictationButton from "./InlineDictationButton.vue";

const recommendationStore = {
  isDictationEnabled: true,
  isDictationSttConfigured: true,
  dictationEngineState: "ready",
};

function makeController() {
  const phase = ref("idle");
  const isRecording = ref(false);
  const elapsedSeconds = ref(0);
  const level = ref(0);
  const error = ref<string | null>(null);
  const pendingInsert = ref<string | null>(null);
  const canApplyPolished = ref(false);
  const hasJob = ref(false);
  const isAvailable = ref(true);
  const isOnline = ref(true);
  return {
    phase,
    isRecording,
    elapsedSeconds,
    level,
    error,
    pendingInsert,
    canApplyPolished,
    hasJob,
    isAvailable,
    isOnline,
    start: vi.fn(async () => {
      isRecording.value = true;
      phase.value = "recording";
    }),
    stop: vi.fn(async () => {
      isRecording.value = false;
      phase.value = "transcribing";
    }),
    cancel: vi.fn(async () => {
      isRecording.value = false;
      phase.value = "idle";
    }),
    insertPending: vi.fn(),
    applyPolished: vi.fn(),
    promote: vi.fn(async () => undefined),
  };
}

type Controller = ReturnType<typeof makeController>;

let controller: Controller;
let field: HTMLInputElement;

function mountButton(props: Record<string, unknown> = {}) {
  return mount(InlineDictationButton, {
    props: { target: () => field, controller, ...props },
  });
}

beforeEach(() => {
  recommendationStore.isDictationEnabled = true;
  recommendationStore.isDictationSttConfigured = true;
  recommendationStore.dictationEngineState = "ready";
  controller = makeController();
  vi.stubGlobal("useRecommendationStore", () => recommendationStore);
  vi.stubGlobal(
    "MediaRecorder",
    class {
      isTypeSupported() {
        return true;
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn() },
    configurable: true,
  });
  field = document.createElement("input");
  document.body.appendChild(field);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("InlineDictationButton visibility", () => {
  it("should render the control when dictation is available", () => {
    const wrapper = mountButton();
    expect(wrapper.find(".inline-dictation").exists()).toBe(true);
    expect(wrapper.find(".inline-dictation-btn").exists()).toBe(true);
  });

  it("should stay hidden when dictation is disabled", () => {
    recommendationStore.isDictationEnabled = false;
    const wrapper = mountButton();
    expect(wrapper.find(".inline-dictation").exists()).toBe(false);
  });

  it("should stay hidden when no STT engine is configured", () => {
    recommendationStore.isDictationSttConfigured = false;
    const wrapper = mountButton();
    expect(wrapper.find(".inline-dictation").exists()).toBe(false);
  });

  it("should stay hidden when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const wrapper = mountButton();
    expect(wrapper.find(".inline-dictation").exists()).toBe(false);
  });

  it("should stay hidden when the host hides the button", () => {
    const wrapper = mountButton({ showButton: false });
    expect(wrapper.find(".inline-dictation").exists()).toBe(false);
  });

  it("should not render a language selector next to the microphone", () => {
    const wrapper = mountButton();
    expect(wrapper.find("select").exists()).toBe(false);
  });
});

describe("InlineDictationButton recording", () => {
  it("should start and stop with the same button", async () => {
    const wrapper = mountButton();
    const button = wrapper.find(".inline-dictation-btn");

    await button.trigger("click");
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(button.attributes("aria-label")).toBe("Stop recording");
    expect(button.attributes("aria-pressed")).toBe("true");

    await button.trigger("click");
    expect(controller.stop).toHaveBeenCalledTimes(1);
  });

  it("should forward the attach-audio option when starting", async () => {
    const wrapper = mountButton({ keepAudio: true });
    await wrapper.find(".inline-dictation-btn").trigger("click");
    expect(controller.start).toHaveBeenCalledWith({ keepAudio: true });
  });

  it("should show the elapsed time and offer stop and cancel", async () => {
    const wrapper = mountButton();
    controller.isRecording.value = true;
    controller.phase.value = "recording";
    controller.elapsedSeconds.value = 65;
    await wrapper.vm.$nextTick();

    const status = wrapper.find(".inline-dictation-status");
    expect(status.exists()).toBe(true);
    expect(wrapper.find(".inline-dictation-timer").text()).toBe("01:05");

    await wrapper
      .find('.inline-dictation-action[aria-label="Stop recording"]')
      .trigger("click");
    expect(controller.stop).toHaveBeenCalledTimes(1);

    // Simulate the recorder having started another take: the status strip
    // shows Cancel only while recording
    controller.isRecording.value = true;
    controller.phase.value = "recording";
    await wrapper.vm.$nextTick();
    await wrapper
      .find('.inline-dictation-action[aria-label="Cancel recording"]')
      .trigger("click");
    expect(controller.cancel).toHaveBeenCalledTimes(1);
  });

  it("should cancel with Escape while recording", async () => {
    mountButton();
    controller.isRecording.value = true;
    controller.phase.value = "recording";

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(controller.cancel).toHaveBeenCalledTimes(1);
  });

  it("should never submit the surrounding form with Enter while recording", () => {
    mountButton();
    controller.isRecording.value = true;
    controller.phase.value = "recording";

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("should toggle from the keyboard shortcut when the field is focused", async () => {
    mountButton();
    field.focus();
    expect(document.activeElement).toBe(field);

    const event = new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("should ignore the keyboard shortcut when another element is focused", () => {
    mountButton();
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        ctrlKey: true,
        altKey: true,
        cancelable: true,
      }),
    );
    expect(controller.start).not.toHaveBeenCalled();
  });

  it("should support hold-to-talk for touch pointers", async () => {
    const wrapper = mountButton();
    const button = wrapper.find(".inline-dictation-btn");

    await button.trigger("pointerdown", { pointerType: "touch", pointerId: 7 });
    expect(controller.start).toHaveBeenCalledTimes(1);

    await button.trigger("pointerup", { pointerType: "touch", pointerId: 7 });
    expect(controller.stop).toHaveBeenCalledTimes(1);

    // The synthetic click that follows a touch must not start a new recording
    await button.trigger("click");
    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("should disable the button while offline", () => {
    controller.isAvailable.value = false;
    controller.isOnline.value = false;
    const wrapper = mountButton();

    const button = wrapper.find(".inline-dictation-btn");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("Dictation needs a connection");
  });

  it("should disable the button while the engine is preparing", () => {
    recommendationStore.dictationEngineState = "preparing";
    const wrapper = mountButton();

    const button = wrapper.find(".inline-dictation-btn");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe(
      "The dictation engine is preparing",
    );
  });

  it("should honor the host disabled flag", () => {
    const wrapper = mountButton({ disabled: true });
    expect(
      wrapper.find(".inline-dictation-btn").attributes("disabled"),
    ).toBeDefined();
  });
});

describe("InlineDictationButton result actions", () => {
  it("should offer to insert a transcript kept while the field was abandoned", async () => {
    const wrapper = mountButton();
    controller.pendingInsert.value = "hello";
    controller.phase.value = "done";
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Transcript ready");
    const insert = wrapper
      .findAll("button")
      .find((button) => button.text() === "Insert transcript");
    expect(insert).toBeDefined();
    await insert!.trigger("click");
    expect(controller.insertPending).toHaveBeenCalledTimes(1);
  });

  it("should offer the improved text when the user edited the insertion", async () => {
    const wrapper = mountButton();
    controller.canApplyPolished.value = true;
    await wrapper.vm.$nextTick();

    const apply = wrapper
      .findAll("button")
      .find((button) => button.text() === "Use improved text");
    expect(apply).toBeDefined();
    await apply!.trigger("click");
    expect(controller.applyPolished).toHaveBeenCalledTimes(1);
  });

  it("should offer to promote a running job to the full dialog", async () => {
    const wrapper = mountButton();
    controller.hasJob.value = true;
    controller.phase.value = "transcribing";
    await wrapper.vm.$nextTick();

    const promote = wrapper
      .findAll("button")
      .find((button) => button.text() === "Review in dictation");
    expect(promote).toBeDefined();
    await promote!.trigger("click");
    expect(controller.promote).toHaveBeenCalledTimes(1);
  });

  it("should show an inline error and let the user dismiss it", async () => {
    const wrapper = mountButton();
    controller.error.value = "Microphone access was denied.";
    await wrapper.vm.$nextTick();

    const error = wrapper.find(".inline-dictation-error");
    expect(error.exists()).toBe(true);
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toContain("Microphone access was denied.");

    await wrapper.find(".inline-dictation-dismiss").trigger("click");
    expect(controller.error.value).toBeNull();
  });
});
