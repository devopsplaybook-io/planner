// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DictationConfidenceReview from "./DictationConfidenceReview.vue";

function segment(text: string, confidence: number | null, fromMs = 0) {
  return { text, fromMs, toMs: fromMs + 500, confidence };
}

describe("DictationConfidenceReview", () => {
  it("should list only the segments under the threshold", () => {
    const wrapper = mount(DictationConfidenceReview, {
      props: {
        segments: [
          segment("kubernetes", 0.35, 0),
          segment("xAuto", 0.9, 500),
          segment("grafana", 0.55, 1000),
          segment("null-confidence", null, 1500),
        ],
        threshold: 0.6,
      },
    });

    const spans = wrapper.findAll(".confidence-span");
    expect(spans).toHaveLength(2);
    expect(spans[0]!.text()).toContain("kubernetes");
    expect(spans[0]!.text()).toContain("35%");
    expect(spans[1]!.text()).toContain("grafana");
  });

  it("should cap the list at 20 spans", () => {
    const segments = Array.from({ length: 25 }, (_, index) =>
      segment(`word-${index}`, 0.2, index * 500),
    );
    const wrapper = mount(DictationConfidenceReview, {
      props: { segments, threshold: 0.6 },
    });
    expect(wrapper.findAll(".confidence-span")).toHaveLength(20);
  });

  it("should say when nothing is uncertain", () => {
    const wrapper = mount(DictationConfidenceReview, {
      props: { segments: [segment("clear", 0.95)], threshold: 0.6 },
    });
    expect(wrapper.text()).toContain("No low-confidence words");
  });

  it("should open a prefilled correction and emit the replacement", async () => {
    const wrapper = mount(DictationConfidenceReview, {
      props: {
        segments: [segment("kubernets", 0.3, 0)],
        threshold: 0.6,
      },
    });

    await wrapper.find(".confidence-span").trigger("click");
    await wrapper.vm.$nextTick();

    const input = wrapper.find('input[aria-label="Correction for kubernets"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("kubernets");

    await input.setValue("kubernetes");
    await wrapper.find(".confidence-editor").trigger("submit");

    expect(wrapper.emitted("apply")).toEqual([
      [{ original: "kubernets", replacement: "kubernetes" }],
    ]);
    expect(wrapper.find(".confidence-editor").exists()).toBe(false);
  });

  it("should add the corrected term to the vocabulary", async () => {
    const wrapper = mount(DictationConfidenceReview, {
      props: {
        segments: [segment("kubernets", 0.3)],
        threshold: 0.6,
      },
    });

    await wrapper.find(".confidence-span").trigger("click");
    await wrapper.vm.$nextTick();
    await wrapper
      .find('input[aria-label="Correction for kubernets"]')
      .setValue("kubernetes");

    const addButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Add to vocabulary");
    await addButton!.trigger("click");

    expect(wrapper.emitted("add-vocabulary")).toEqual([["kubernetes"]]);
  });

  it("should render the parent notice in a live region", () => {
    const wrapper = mount(DictationConfidenceReview, {
      props: {
        segments: [segment("kubernets", 0.3)],
        threshold: 0.6,
        notice: "Could not find the word in the text.",
      },
    });
    const notice = wrapper.find(".confidence-notice");
    expect(notice.text()).toBe("Could not find the word in the text.");
    expect(notice.attributes("aria-live")).toBe("polite");
  });
});
