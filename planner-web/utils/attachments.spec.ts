// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "./api";
import { downloadAttachment, fetchAttachmentObjectUrl, isAudioFile } from "./attachments";

vi.mock("./api", () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockedGet = api.get as ReturnType<typeof vi.fn>;

describe("isAudioFile", () => {
  it("detects audio extensions case-insensitively", () => {
    expect(isAudioFile("voice-message.webm")).toBe(true);
    expect(isAudioFile("voice-message.m4a")).toBe(true);
    expect(isAudioFile("song.MP3")).toBe(true);
    expect(isAudioFile("tone.WAV")).toBe(true);
    expect(isAudioFile("track.ogg")).toBe(true);
    expect(isAudioFile("track.oga")).toBe(true);
    expect(isAudioFile("clip.opus")).toBe(true);
    expect(isAudioFile("album.flac")).toBe(true);
    expect(isAudioFile("book.aac")).toBe(true);
  });

  it("rejects non-audio files", () => {
    expect(isAudioFile("photo.png")).toBe(false);
    expect(isAudioFile("spec.pdf")).toBe(false);
    expect(isAudioFile("video.mp4")).toBe(false);
    expect(isAudioFile("archive.zip")).toBe(false);
    expect(isAudioFile("noextension")).toBe(false);
  });
});

describe("fetchAttachmentObjectUrl", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("fetches through the axios instance as a blob and returns an object URL", async () => {
    const blob = new Blob(["img-bytes"], { type: "image/png" });
    mockedGet.mockResolvedValue({ data: blob });
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:planner/preview");

    const url = await fetchAttachmentObjectUrl(
      "/tasks/task-1/attachments/att-1?inline=true",
    );

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const [requestUrl, config] = mockedGet.mock.calls[0]!;
    // Bearer auth comes from the shared axios interceptor; the URL itself
    // must never carry a token
    expect(requestUrl).toBe("/tasks/task-1/attachments/att-1?inline=true");
    expect(requestUrl).not.toContain("token=");
    expect(config).toEqual({ responseType: "blob" });
    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(url).toBe("blob:planner/preview");
  });

  it("propagates request failures", async () => {
    mockedGet.mockRejectedValue(new Error("Unauthorized"));
    await expect(
      fetchAttachmentObjectUrl("/tasks/task-1/attachments/att-1"),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("downloadAttachment", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("clicks a temporary download anchor and revokes the object URL", async () => {
    const blob = new Blob(["file-bytes"]);
    mockedGet.mockResolvedValue({ data: blob });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:planner/download");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadAttachment(
      "/tasks/task-1/attachments/att-1",
      "quarterly report.pdf",
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:planner/download");
    // No anchor left behind in the DOM
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });
});
