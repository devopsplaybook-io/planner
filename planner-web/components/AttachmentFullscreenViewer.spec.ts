// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import AttachmentFullscreenViewer from "./AttachmentFullscreenViewer.vue";
import { GlobalWorkerOptions } from "pdfjs-dist";

const getDocumentMock = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf-worker.mjs",
}));

function fakePdfDocument(numPages: number) {
  return {
    numPages,
    destroy: vi.fn(),
    getPage: vi.fn(async (_pageNum: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
      }),
      render: vi.fn(() => ({ promise: Promise.resolve() })),
    })),
  };
}

async function flushAll(times = 6) {
  for (let i = 0; i < times; i++) {
    await flushPromises();
  }
}

describe("AttachmentFullscreenViewer", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
  });

  it("renders an image for an image attachment", () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "photo.png", url: "blob:planner/photo" },
      },
    });

    const img = wrapper.find("img.fullscreen-image");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("blob:planner/photo");
    expect(img.attributes("alt")).toBe("photo.png");
  });

  it("renders PDF pages on canvas through pdf.js (mobile browsers cannot render PDFs in iframes)", async () => {
    const doc = fakePdfDocument(2);
    getDocumentMock.mockReturnValue({ promise: Promise.resolve(doc) });
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "spec.pdf", url: "blob:planner/spec" },
      },
    });
    await flushAll();

    const pdfPanel = wrapper.find(".fullscreen-pdf");
    expect(pdfPanel.exists()).toBe(true);
    expect(wrapper.find("iframe").exists()).toBe(false);
    // The worker must be bundled locally (the ?url import), not from a CDN
    expect(GlobalWorkerOptions.workerSrc).toBe("/pdf-worker.mjs");
    const canvases = wrapper.findAll("canvas.pdf-page");
    expect(canvases).toHaveLength(2);
    expect(canvases[0]?.attributes("aria-label")).toBe("Page 1 of 2");
    // The fit sizing is set inline: scoped CSS never matches the
    // imperatively created canvases
    expect(canvases[0]?.attributes("style")).toContain("width: 100%");
    expect(canvases[0]?.attributes("style")).toContain("height: auto");
    expect(getDocumentMock).toHaveBeenCalledWith({ url: "blob:planner/spec" });
    expect(wrapper.find(".pdf-loading").exists()).toBe(false);
  });

  it("shows an error message when the PDF cannot be loaded", async () => {
    getDocumentMock.mockReturnValue(
      { promise: Promise.reject(new Error("boom")) },
    );
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "broken.pdf", url: "blob:planner/broken" },
      },
    });
    await flushAll();

    expect(wrapper.find(".pdf-message").exists()).toBe(true);
    expect(wrapper.findAll("canvas")).toHaveLength(0);
  });

  it("renders nothing for a null attachment", () => {
    const wrapper = mount(AttachmentFullscreenViewer);

    expect(wrapper.find(".fullscreen-overlay").exists()).toBe(false);
  });

  it("renders no pdf panel for a file without a viewer kind", () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "archive.zip", url: "blob:planner/zip" },
      },
    });

    expect(wrapper.find(".fullscreen-overlay").exists()).toBe(true);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find(".fullscreen-pdf").exists()).toBe(false);
  });

  it("emits close when the overlay is clicked", async () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "photo.png", url: "blob:planner/photo" },
      },
    });

    await wrapper.find(".fullscreen-overlay").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits close from the close button but not when the content is clicked", async () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "photo.png", url: "blob:planner/photo" },
      },
    });

    await wrapper.find("img.fullscreen-image").trigger("click");
    expect(wrapper.emitted("close")).toBeUndefined();

    await wrapper.find(".fullscreen-btn[aria-label='Close']").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("downloads the attachment from the download button", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "spec.pdf", url: "blob:planner/spec" },
      },
    });

    await wrapper
      .find(".fullscreen-btn[aria-label='Download']")
      .trigger("click");

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
