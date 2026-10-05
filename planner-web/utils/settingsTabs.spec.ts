import { describe, expect, it } from "vitest";
import { getSettingsTabs, normalizeSettingsTab } from "./settingsTabs";

describe("getSettingsTabs", () => {
  it("should list Profile as the first tab for every role", () => {
    expect(getSettingsTabs(false)[0]).toEqual({
      id: "profile",
      label: "Profile",
    });
    expect(getSettingsTabs(true)[0]).toEqual({
      id: "profile",
      label: "Profile",
    });
  });

  it("should only expose the Profile tab to non-admin users", () => {
    expect(getSettingsTabs(false)).toEqual([
      { id: "profile", label: "Profile" },
    ]);
  });

  it("should expose all tabs in order to admins", () => {
    expect(getSettingsTabs(true).map((tab) => tab.id)).toEqual([
      "profile",
      "users",
      "projects",
      "statuses",
    ]);
  });
});

describe("normalizeSettingsTab", () => {
  it("should keep allowed tabs per role", () => {
    expect(normalizeSettingsTab("profile", false)).toBe("profile");
    expect(normalizeSettingsTab("users", true)).toBe("users");
    expect(normalizeSettingsTab("projects", true)).toBe("projects");
    expect(normalizeSettingsTab("statuses", true)).toBe("statuses");
  });

  it("should fall back to profile for unknown tabs", () => {
    expect(normalizeSettingsTab("unknown", true)).toBe("profile");
    expect(normalizeSettingsTab(undefined, true)).toBe("profile");
  });

  it("should fall back to profile when a non-admin requests an admin tab", () => {
    expect(normalizeSettingsTab("users", false)).toBe("profile");
    expect(normalizeSettingsTab("projects", false)).toBe("profile");
    expect(normalizeSettingsTab("statuses", false)).toBe("profile");
  });
});
