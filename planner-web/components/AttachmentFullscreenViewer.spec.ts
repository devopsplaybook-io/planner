// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AttachmentFullscreenViewer from "./AttachmentFullscreenViewer.vue";

describe("AttachmentFullscreenViewer", () => {
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
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("renders an iframe without sandbox for a PDF attachment", () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "spec.pdf", url: "blob:planner/spec" },
      },
    });

    const iframe = wrapper.find("iframe.fullscreen-pdf");
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes("src")).toBe("blob:planner/spec");
    expect(iframe.attributes("title")).toBe("spec.pdf");
    // A sandboxed frame blocks the browser's built-in PDF viewer
    expect(iframe.attributes("sandbox")).toBeUndefined();
    expect(wrapper.find("img").exists()).toBe(false);
  });

  it("renders nothing for a null attachment", () => {
    const wrapper = mount(AttachmentFullscreenViewer);

    expect(wrapper.find(".fullscreen-overlay").exists()).toBe(false);
  });

  it("renders nothing for a file without a viewer kind", () => {
    const wrapper = mount(AttachmentFullscreenViewer, {
      props: {
        attachment: { fileName: "archive.zip", url: "blob:planner/zip" },
      },
    });

    expect(wrapper.find(".fullscreen-overlay").exists()).toBe(true);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("iframe").exists()).toBe(false);
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

    await wrapper.find(".fullscreen-close").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
