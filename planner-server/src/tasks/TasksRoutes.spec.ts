import { parseDoneSince } from "./TasksRoutes";

describe("parseDoneSince", () => {
  it("should return undefined for absent, null or empty values", () => {
    expect(parseDoneSince(undefined)).toBeUndefined();
    expect(parseDoneSince(null)).toBeUndefined();
    expect(parseDoneSince("")).toBeUndefined();
  });

  it("should accept a full ISO 8601 timestamp and normalize it", () => {
    expect(parseDoneSince("2026-08-14T10:30:00.000Z")).toBe(
      "2026-08-14T10:30:00.000Z",
    );
    expect(parseDoneSince("2026-08-14")).toBe("2026-08-14T00:00:00.000Z");
  });

  it("should normalize non-UTC offsets to UTC", () => {
    expect(parseDoneSince("2026-08-14T10:30:00+02:00")).toBe(
      "2026-08-14T08:30:00.000Z",
    );
  });

  it("should reject garbage values", () => {
    expect(() => parseDoneSince("garbage")).toThrow();
    expect(() => parseDoneSince("not a date")).toThrow();
    expect(() => parseDoneSince("2026-13-45")).toThrow();
  });
});
