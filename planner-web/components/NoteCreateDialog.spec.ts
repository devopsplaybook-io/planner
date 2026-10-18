// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref, watch } from "vue";

import NoteCreateDialog from "./NoteCreateDialog.vue";

// The dialog relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them before mounting.
vi.stubGlobal("ref", ref);
vi.stubGlobal("watch", watch);
vi.stubGlobal("useModalDialog", () => ref(null));

const notesStore = { create: vi.fn() };
const projectsStore = {
  selectedProjectFilter: "",
  activeProjects: [{ id: "project-1", archived: false }],
  defaultProject: { id: "project-1", archived: false },
};
vi.stubGlobal("useNotesStore", () => notesStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);

const NullStub = defineComponent({ render: () => null });

function mountDialog() {
  return mount(NoteCreateDialog, {
    props: { open: false },
    global: { components: { ProjectSelect: NullStub } },
  });
}

async function openDialog() {
  const wrapper = mountDialog();
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  notesStore.create.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoteCreateDialog design language", () => {
  it("should render the header actions and no footer button row", async () => {
    const wrapper = await openDialog();
    expect(wrapper.find(".dialog-header").exists()).toBe(true);
    expect(wrapper.find(".dialog-actions").exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Create note"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('button[aria-label="Cancel"]').exists()).toBe(true);
    const close = wrapper.find('button[aria-label="Close"]');
    expect(close.exists()).toBe(true);
    expect(close.text()).toBe("×");
    expect(wrapper.find(".dialog-footer").exists()).toBe(false);
  });

  it("should emit created with the new id and close on success", async () => {
    notesStore.create.mockResolvedValue({ id: "note-1" });
    const wrapper = await openDialog();
    await wrapper.find("input[type=text]").setValue("My note");
    await wrapper.find('button[aria-label="Create note"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("created")).toEqual([["note-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("should show the inline error banner and never alert when create fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    notesStore.create.mockRejectedValue({
      response: { data: { error: "boom" } },
    });
    const wrapper = await openDialog();
    await wrapper.find('button[aria-label="Create note"]').trigger("click");
    await flushPromises();
    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("boom");
    expect(alertSpy).not.toHaveBeenCalled();
    await wrapper.find(".dialog-error-dismiss").trigger("click");
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });
});
