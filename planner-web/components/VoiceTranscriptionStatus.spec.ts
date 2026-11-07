// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VoiceTranscriptionStatus from "./VoiceTranscriptionStatus.vue";

function mountStatus(props = {}) {
  return mount(VoiceTranscriptionStatus, {
    props: { attachmentId: "att-1", ...props },
  });
}

describe("VoiceTranscriptionStatus", () => {
  it("should show the transcribing state", () => {
    const wrapper = mountStatus({ status: "processing" });
    expect(wrapper.text()).toContain("Transcribing");
    expect(wrapper.find(".is-processing").exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("should show a finishing label during polish", () => {
    const wrapper = mountStatus({ status: "processing", stage: "polishing" });
    expect(wrapper.text()).toContain("Finishing transcript");
  });

  it("should show the ready state", () => {
    const wrapper = mountStatus({ status: "done" });
    expect(wrapper.text()).toContain("Transcript ready");
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("should offer a retry after a failure", async () => {
    const wrapper = mountStatus({ status: "error" });
    expect(wrapper.text()).toContain("Transcription failed");
    const button = wrapper.find("button");
    expect(button.text()).toBe("Retry");
    await button.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("should offer a retry when the transcription was skipped", () => {
    const wrapper = mountStatus({ status: "skipped" });
    expect(wrapper.text()).toContain("Transcription skipped");
    expect(wrapper.find("button").text()).toBe("Retry");
  });

  it("should offer to transcribe when there is no job yet", () => {
    const wrapper = mountStatus({ status: null });
    expect(wrapper.find(".is-idle").exists()).toBe(true);
    expect(wrapper.find("button").text()).toBe("Transcribe");
  });

  it("should disable the action while retrying", () => {
    const wrapper = mountStatus({ status: "error", retrying: true });
    const button = wrapper.find("button");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("aria-busy")).toBe("true");
    expect(button.text()).toBe("Retrying…");
  });
});
