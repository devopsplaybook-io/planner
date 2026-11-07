// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DictationAskPanel from "./DictationAskPanel.vue";

function mountPanel(props = {}) {
  return mount(DictationAskPanel, {
    props,
    global: {
      stubs: { InlineDictationButton: true },
    },
  });
}

describe("DictationAskPanel", () => {
  it("should emit the trimmed question without a scope", async () => {
    const wrapper = mountPanel();

    await wrapper.find("textarea").setValue("  What is due today?  ");
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("ask")?.[0]).toEqual([
      { question: "What is due today?", projectId: null },
    ]);
  });

  it("should disable Ask until a question is typed", async () => {
    const wrapper = mountPanel();

    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();

    await wrapper.find("textarea").setValue("What is due today?");

    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("should include the selected project scope", async () => {
    const wrapper = mountPanel({
      projects: [
        { id: "p1", name: "Planner" },
        { id: "p2", name: "Website" },
      ],
    });

    await wrapper.find("textarea").setValue("Summarize the project");
    await wrapper.find('select[aria-label="Question project scope"]').setValue(
      "p2",
    );
    await wrapper.find("form").trigger("submit");

    expect(wrapper.emitted("ask")?.[0]).toEqual([
      { question: "Summarize the project", projectId: "p2" },
    ]);
  });

  it("should render a computed answer with linked items", () => {
    const wrapper = mountPanel({
      answer: {
        answer: "2 tasks are due today.",
        items: [
          { kind: "task", id: "t1", title: "Buy milk", projectName: "Home" },
          { kind: "note", id: "n1", title: "Ideas", projectName: null },
        ],
        generatedBy: "deterministic",
        truncated: true,
      },
    });

    expect(wrapper.find(".ask-text").text()).toBe("2 tasks are due today.");
    const links = wrapper.findAll(".ask-items a");
    expect(links.map((link) => link.attributes("href"))).toEqual([
      "/tasks/t1",
      "/notes/n1",
    ]);
    expect(wrapper.text()).toContain("Computed from your data.");
    expect(wrapper.text()).toContain("Some results are not shown");
  });

  it("should state when the answer was rephrased by AI", () => {
    const wrapper = mountPanel({
      answer: {
        answer: "Nothing is due today.",
        items: [],
        generatedBy: "llm",
        truncated: false,
      },
    });

    expect(wrapper.find(".ask-source").text()).toBe(
      "Rephrased by AI from your data.",
    );
  });

  it("should show the loading and error states", () => {
    const wrapper = mountPanel({
      loading: true,
      error: "The question could not be answered.",
    });

    expect(wrapper.find(".ask-loading").text()).toContain("Looking up");
    expect(wrapper.find(".ask-error").text()).toBe(
      "The question could not be answered.",
    );
    expect(
      wrapper.find('button[type="submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("should always state that the assistant is read-only", () => {
    const wrapper = mountPanel();

    expect(wrapper.find(".ask-hint").text()).toContain("Read-only");
  });
});
