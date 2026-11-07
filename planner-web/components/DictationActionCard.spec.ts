// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DictationActionCard from "./DictationActionCard.vue";

function preview(overrides = {}) {
  return {
    index: 0,
    type: "create_task",
    action: { type: "create_task", title: "Buy milk", description: "" },
    status: "resolved",
    target: null,
    candidates: [],
    diff: [],
    resolvedProjectId: "p1",
    resolvedStatus: "To Do",
    ...overrides,
  };
}

function mountCard(props = {}) {
  return mount(DictationActionCard, {
    props: { preview: preview(), selected: false, ...props },
  });
}

describe("DictationActionCard", () => {
  it("should render a resolved action as ready and selectable", () => {
    const wrapper = mountCard();

    expect(wrapper.find(".action-type").text()).toContain("Task");
    expect(wrapper.find(".resolution-badge").text()).toBe("Ready");
    expect(
      (wrapper.find(".action-title").element as HTMLInputElement).value,
    ).toBe("Buy milk");
    const checkbox = wrapper.find('input[type="checkbox"]');
    expect(checkbox.attributes("disabled")).toBeUndefined();
  });

  it("should emit the selection change", async () => {
    const wrapper = mountCard();

    await wrapper.find('input[type="checkbox"]').setValue(true);

    expect(wrapper.emitted("update:selected")?.[0]).toEqual([true]);
  });

  it("should keep an ambiguous action disabled until a match is picked", async () => {
    const wrapper = mountCard({
      preview: preview({
        index: 1,
        type: "append_to_task",
        action: { type: "append_to_task", target: "Login", text: "More" },
        status: "ambiguous",
        candidates: [
          { kind: "task", id: "t1", label: "Login bug", projectName: "Planner" },
        ],
        error: "Several tasks match this name",
      }),
    });

    expect(wrapper.find(".resolution-badge").text()).toBe("Needs a choice");
    expect(
      wrapper.find('input[type="checkbox"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.find(".action-error").text()).toBe(
      "Several tasks match this name",
    );

    await wrapper.find(".action-candidates button").trigger("click");

    expect(wrapper.emitted("override")?.[0]).toEqual([
      { index: 1, field: "targetId", value: "t1" },
    ]);
  });

  it("should enable an ambiguous action once an override is present", () => {
    const wrapper = mountCard({
      preview: preview({ status: "ambiguous", candidates: [] }),
      overrides: { targetId: "t1" },
    });

    expect(
      wrapper.find('input[type="checkbox"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("should emit a project override from the candidate list", async () => {
    const wrapper = mountCard({
      preview: preview({
        status: "ambiguous",
        candidates: [
          { kind: "project", id: "p2", label: "Website", projectName: null },
        ],
      }),
    });

    await wrapper.find(".action-candidates button").trigger("click");

    expect(wrapper.emitted("override")?.[0]).toEqual([
      { index: 0, field: "projectId", value: "p2" },
    ]);
  });

  it("should emit title, description, project and status overrides", async () => {
    const wrapper = mountCard({
      projects: [{ id: "p1", name: "Planner", statuses: ["To Do", "Done"] }],
    });

    await wrapper.find(".action-title").setValue("Buy oat milk");
    await wrapper.find("textarea").setValue("From the corner shop");
    await wrapper.find('select[aria-label="Task project"]').setValue("p1");
    await wrapper.find('select[aria-label="Task status"]').setValue("Done");

    const overrides = wrapper.emitted("override")!.map((event) => event[0]);
    expect(overrides).toContainEqual({
      index: 0,
      field: "title",
      value: "Buy oat milk",
    });
    expect(overrides).toContainEqual({
      index: 0,
      field: "description",
      value: "From the corner shop",
    });
    expect(overrides).toContainEqual({
      index: 0,
      field: "projectId",
      value: "p1",
    });
    expect(overrides).toContainEqual({
      index: 0,
      field: "status",
      value: "Done",
    });
  });

  it("should render the diff and the apply result", () => {
    const wrapper = mountCard({
      preview: preview({
        type: "update_task",
        action: { type: "update_task", target: "Login" },
        target: { kind: "task", id: "t1", label: "Login bug", projectName: null },
        diff: [{ field: "title", before: "Login", after: "Login bug" }],
      }),
      result: { index: 0, status: "failed", error: "Not allowed" },
    });

    expect(wrapper.find(".action-target").text()).toContain("Task: Login bug");
    expect(wrapper.find(".action-diff").text()).toContain("Login bug");
    expect(wrapper.find(".action-result").text()).toContain("Failed");
    expect(wrapper.find(".action-result").text()).toContain("Not allowed");
  });

  it("should disable the checkbox while busy", () => {
    const wrapper = mountCard({ busy: true });

    expect(
      wrapper.find('input[type="checkbox"]').attributes("disabled"),
    ).toBeDefined();
  });
});
