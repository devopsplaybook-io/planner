// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DictationDiff from "./DictationDiff.vue";
import { TEXT_DIFF_TOKEN_LIMIT } from "../utils/textDiff";

describe("DictationDiff", () => {
  it("should render removed and added words inline", () => {
    const wrapper = mount(DictationDiff, {
      props: { raw: "hello wrld", polished: "Hello world." },
    });

    expect(wrapper.find(".diff-inline").exists()).toBe(true);
    const removed = wrapper.findAll("del").map((node) => node.text());
    const added = wrapper.findAll("ins").map((node) => node.text());
    expect(removed.join("")).toContain("wrld");
    expect(added.join("")).toContain("world");
    expect(wrapper.find(".diff-columns").exists()).toBe(false);
  });

  it("should render text without interpreting markup", () => {
    const wrapper = mount(DictationDiff, {
      props: { raw: "<script>alert(1)</script>", polished: "<b>safe</b>" },
    });
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find(".diff-inline").text()).toContain("<script>");
  });

  it("should fall back to side-by-side above the token limit", () => {
    const long = Array.from({ length: TEXT_DIFF_TOKEN_LIMIT + 1 }, () => "x")
      .join(" ");
    const wrapper = mount(DictationDiff, {
      props: { raw: long, polished: "short" },
    });

    expect(wrapper.find(".diff-note").exists()).toBe(true);
    expect(wrapper.find(".diff-columns").exists()).toBe(true);
    expect(wrapper.findAll(".diff-column")).toHaveLength(2);
    expect(wrapper.find(".diff-inline").exists()).toBe(false);
  });
});
