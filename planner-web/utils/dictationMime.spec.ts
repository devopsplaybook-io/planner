import { afterEach, describe, expect, it, vi } from "vitest";
import { fileExtensionForMimeType, pickRecordingMimeType } from "./dictationMime";

function stubRecorder(isSupported: (type: string) => boolean) {
  const recorder = { isTypeSupported: vi.fn(isSupported) };
  vi.stubGlobal("MediaRecorder", recorder);
  return recorder;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickRecordingMimeType", () => {
  it("should return an empty string when MediaRecorder is unsupported", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickRecordingMimeType()).toBe("");
  });

  it("should prefer Opus/WebM when supported", () => {
    stubRecorder((type) => type === "audio/webm;codecs=opus");
    expect(pickRecordingMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("should fall back to MP4/AAC for Safari and iOS", () => {
    stubRecorder((type) => type === "audio/mp4");
    expect(pickRecordingMimeType()).toBe("audio/mp4");
  });

  it("should fall back to plain webm when codecs are not advertised", () => {
    stubRecorder((type) => type === "audio/webm");
    expect(pickRecordingMimeType()).toBe("audio/webm");
  });

  it("should return an empty string when no candidate is supported", () => {
    stubRecorder(() => false);
    expect(pickRecordingMimeType()).toBe("");
  });
});

describe("fileExtensionForMimeType", () => {
  it("should map mp4 recordings to .m4a", () => {
    expect(fileExtensionForMimeType("audio/mp4")).toBe(".m4a");
  });

  it("should map ogg recordings to .ogg", () => {
    expect(fileExtensionForMimeType("audio/ogg;codecs=opus")).toBe(".ogg");
  });

  it("should default to .webm", () => {
    expect(fileExtensionForMimeType("audio/webm;codecs=opus")).toBe(".webm");
    expect(fileExtensionForMimeType("")).toBe(".webm");
  });
});
