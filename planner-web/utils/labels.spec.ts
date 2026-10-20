import { describe, expect, it } from "vitest";
import {
  MACHINE_LABEL_PREFIXES,
  isMachineLabel,
  parseLabelQuery,
  serializeLabelQuery,
} from "./labels";

describe("parseLabelQuery", () => {
  it("should return an empty list for absent, non-string or empty values", () => {
    expect(parseLabelQuery(undefined)).toEqual([]);
    expect(parseLabelQuery(null)).toEqual([]);
    expect(parseLabelQuery(42)).toEqual([]);
    expect(parseLabelQuery("")).toEqual([]);
    expect(parseLabelQuery("   ")).toEqual([]);
    expect(parseLabelQuery(" , , ")).toEqual([]);
  });

  it("should split on commas and trim each name", () => {
    expect(parseLabelQuery(" urgent , ui ")).toEqual(["urgent", "ui"]);
  });

  it("should drop empty segments and de-duplicate names", () => {
    expect(parseLabelQuery("urgent,,ui,urgent")).toEqual(["urgent", "ui"]);
  });

  it("should keep machine label names (the dashboard filter can bookmark them)", () => {
    expect(parseLabelQuery("agent:running,model:gpt-5")).toEqual([
      "agent:running",
      "model:gpt-5",
    ]);
  });

  it("should ignore a repeated query param (array value)", () => {
    expect(parseLabelQuery(["urgent", "ui"])).toEqual([]);
  });
});

describe("serializeLabelQuery", () => {
  it("should join names with commas", () => {
    expect(serializeLabelQuery(["urgent", "ui"])).toBe("urgent,ui");
  });

  it("should return undefined for an empty selection (removes the param)", () => {
    expect(serializeLabelQuery([])).toBeUndefined();
  });
});

describe("isMachineLabel", () => {
  it("should detect the reserved agent: and model: prefixes", () => {
    expect(MACHINE_LABEL_PREFIXES).toEqual(["agent:", "model:"]);
    expect(isMachineLabel("agent:running")).toBe(true);
    expect(isMachineLabel("model:gpt-5")).toBe(true);
  });

  it("should not match human labels, including mid-string prefixes", () => {
    expect(isMachineLabel("urgent")).toBe(false);
    expect(isMachineLabel("my-agent:running")).toBe(false);
    expect(isMachineLabel("Agent:running")).toBe(false);
  });
});
