// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LabelMultiSelect from "./LabelMultiSelect.vue";

const suggestions = [
  { name: "agent:running", count: 2 },
  { name: "model:gpt-5", count: 1 },
  { name: "bug", count: 4 },
];

async function openDropdown(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("input.lms-input").trigger("focus");
}

describe("LabelMultiSelect excludePrefixes", () => {
  it("should hide suggestions with a reserved prefix", async () => {
    const wrapper = mount(LabelMultiSelect, {
      props: {
        modelValue: [],
        suggestions,
        excludePrefixes: ["agent:", "model:"],
      },
    });
    await openDropdown(wrapper);
    const options = wrapper.findAll(".lms-option");
    expect(options.map((o) => o.text())).toEqual([
      expect.stringContaining("bug"),
    ]);
  });

  it("should show every suggestion without the prop (dashboard filter)", async () => {
    const wrapper = mount(LabelMultiSelect, {
      props: { modelValue: [], suggestions },
    });
    await openDropdown(wrapper);
    expect(wrapper.findAll(".lms-option")).toHaveLength(3);
  });

  it("should allow typing a machine label by hand", async () => {
    const wrapper = mount(LabelMultiSelect, {
      props: {
        modelValue: [],
        suggestions,
        excludePrefixes: ["agent:", "model:"],
      },
    });
    await openDropdown(wrapper);
    await wrapper.find("input.lms-input").setValue("agent:running");
    await wrapper.find("input.lms-input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([
      "agent:running",
    ]);
  });
});

describe("LabelMultiSelect editing", () => {
  it("should add a selected suggestion to the model", async () => {
    const wrapper = mount(LabelMultiSelect, {
      props: { modelValue: ["urgent"], suggestions },
    });
    await openDropdown(wrapper);
    await wrapper.findAll(".lms-option")[0]!.trigger("mousedown");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([
      "urgent",
      "agent:running",
    ]);
  });

  it("should remove a chip", async () => {
    const wrapper = mount(LabelMultiSelect, {
      props: { modelValue: ["urgent", "bug"], suggestions },
    });
    await wrapper.findAll(".lms-remove")[0]!.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(["bug"]);
  });
});
