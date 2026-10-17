// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import UserMultiSelect from "./UserMultiSelect.vue";

const users = [
  { id: "user-1", name: "Alice" },
  { id: "user-2", name: "Bob" },
];

describe("UserMultiSelect", () => {
  it("should render plain chips without permission selects by default", () => {
    const wrapper = mount(UserMultiSelect, {
      props: { modelValue: ["user-1"], users },
    });
    expect(wrapper.find(".ums-chip").text()).toContain("Alice");
    expect(wrapper.find("select.ums-permission").exists()).toBe(false);
  });

  it("should render a permission select per chip when withPermissions is set", () => {
    const wrapper = mount(UserMultiSelect, {
      props: {
        modelValue: ["user-1", "user-2"],
        users,
        withPermissions: true,
        permissions: { "user-2": "view" },
      },
    });
    const selects = wrapper.findAll("select.ums-permission");
    expect(selects).toHaveLength(2);
    expect((selects[0]!.element as HTMLSelectElement).value).toBe("all");
    expect((selects[1]!.element as HTMLSelectElement).value).toBe("view");
    const options = selects[0]!.findAll("option");
    expect(options.map((o) => o.element.value)).toEqual([
      "all",
      "update",
      "comment",
      "view",
    ]);
  });

  it("should emit update:permissions when a level changes", async () => {
    const wrapper = mount(UserMultiSelect, {
      props: {
        modelValue: ["user-1"],
        users,
        withPermissions: true,
        permissions: { "user-1": "all" },
      },
    });
    await wrapper.find("select.ums-permission").setValue("comment");
    expect(wrapper.emitted("update:permissions")?.[0]?.[0]).toEqual({
      "user-1": "comment",
    });
  });

  it("should still emit update:modelValue when chips are added or removed", async () => {
    const wrapper = mount(UserMultiSelect, {
      props: { modelValue: ["user-1"], users, withPermissions: true },
    });
    await wrapper.find(".ums-remove").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([]);
  });

  it("should disable the permission selects when disabled", () => {
    const wrapper = mount(UserMultiSelect, {
      props: {
        modelValue: ["user-1"],
        users,
        withPermissions: true,
        disabled: true,
      },
    });
    expect(
      wrapper.find("select.ums-permission").attributes("disabled"),
    ).toBeDefined();
  });
});
