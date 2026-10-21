// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TagCloud from "./TagCloud.vue";

const tags = [
  { name: "agent:running", count: 2 },
  { name: "homework", count: 4 },
  { name: "bug", count: 4 },
];

describe("TagCloud", () => {
  it("should render nothing when no label is in use", () => {
    const wrapper = mount(TagCloud, { props: { tags: [], modelValue: [] } });
    expect(wrapper.find(".tag-cloud").exists()).toBe(false);
  });

  it("should list tags by usage then name with their counts", () => {
    const wrapper = mount(TagCloud, { props: { tags, modelValue: [] } });
    const chips = wrapper.findAll(".cloud-tag");
    expect(chips.map((chip) => chip.text().split(/\s+/)[0])).toEqual([
      "bug",
      "homework",
      "agent:running",
    ]);
    expect(chips.map((chip) => chip.find(".cloud-tag-count").text())).toEqual([
      "4",
      "4",
      "2",
    ]);
  });

  it("should add a tag to the filter when clicked", async () => {
    const wrapper = mount(TagCloud, {
      props: { tags, modelValue: ["bug"] },
    });
    await wrapper.findAll(".cloud-tag")[1]!.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([
      "bug",
      "homework",
    ]);
  });

  it("should remove an active tag from the filter when clicked", async () => {
    const wrapper = mount(TagCloud, {
      props: { tags, modelValue: ["bug", "homework"] },
    });
    await wrapper.findAll(".cloud-tag")[0]!.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([
      "homework",
    ]);
  });

  it("should highlight active tags and expose their pressed state", () => {
    const wrapper = mount(TagCloud, {
      props: { tags, modelValue: ["homework"] },
    });
    const chips = wrapper.findAll(".cloud-tag");
    expect(chips[1]!.classes()).toContain("is-active");
    expect(chips[1]!.attributes("aria-pressed")).toBe("true");
    expect(chips[0]!.classes()).not.toContain("is-active");
    expect(chips[0]!.attributes("aria-pressed")).toBe("false");
  });
});
