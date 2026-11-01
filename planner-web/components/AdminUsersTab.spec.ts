// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { onMounted, ref } from "vue";

import AdminUsersTab from "./AdminUsersTab.vue";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("../utils/api", () => ({ default: api }));

const authStore = { currentUser: { id: "admin-1" } };
const router = { push: vi.fn() };

vi.stubGlobal("ref", ref);
vi.stubGlobal("onMounted", onMounted);
vi.stubGlobal("useModalDialog", () => ref(null));
vi.stubGlobal("useAuthStore", () => authStore);
vi.stubGlobal("useRouter", () => router);

const userWithoutKey = {
  id: "user-1",
  name: "Alice",
  role: "user",
  dateCreated: null,
  apiKey: null,
};
const userWithKey = {
  id: "user-2",
  name: "Bob",
  role: "user",
  dateCreated: null,
  apiKey: { keyPrefix: "abc" },
};

function mockUserList(
  users: Record<string, unknown>[],
  apiKeyData: Record<string, unknown> | null = {
    key: "masked-key",
    dateCreated: "2026-01-01",
  },
) {
  api.get.mockImplementation((url: string) => {
    if (url === "/users") {
      return Promise.resolve({ data: users });
    }
    return Promise.resolve({ data: apiKeyData });
  });
}

async function mountTab() {
  const wrapper = mount(AdminUsersTab);
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: [] });
  api.post.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminUsersTab custom errors and confirms", () => {
  it("shows the dialog banner and never alerts when creating a user fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockRejectedValueOnce({ response: { data: { error: "boom" } } });
    const wrapper = await mountTab();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("boom");
    expect(alertSpy).not.toHaveBeenCalled();

    await wrapper.find(".dialog-error-dismiss").trigger("click");
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });

  it("shows the page banner and never alerts when a role update fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockUserList([userWithoutKey]);
    const wrapper = await mountTab();

    api.put.mockRejectedValueOnce({
      response: { data: { error: "role boom" } },
    });
    await wrapper.find("tbody select").setValue("admin");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("role boom");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows the API-key banner and never alerts when generating a key fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockUserList([userWithoutKey], null);
    const wrapper = await mountTab();

    await findButton(wrapper, "Generate")?.trigger("click");
    await flushPromises();
    api.post.mockRejectedValueOnce({
      response: { data: { error: "key boom" } },
    });
    await findButton(wrapper, "Generate API Key")?.trigger("click");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("key boom");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("regenerates the API key only after confirming in the inner dialog", async () => {
    mockUserList([userWithKey]);
    api.post.mockResolvedValueOnce({ data: { key: "new-key" } });
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const wrapper = await mountTab();

    await findButton(wrapper, "Manage")?.trigger("click");
    await flushPromises();

    const footerButtons = wrapper.findAll(
      ".api-key-admin-display .dialog-footer button",
    );
    await footerButtons[0]!.trigger("click");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();

    const confirmButton = wrapper
      .findAll(".inner-dialog button")
      .find((button) => button.text() === "Regenerate");
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/users/user-2/api-key");
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("deletes the API key only after confirming in the inner dialog", async () => {
    mockUserList([userWithKey]);
    api.delete.mockResolvedValueOnce({ data: {} });
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const wrapper = await mountTab();

    await findButton(wrapper, "Manage")?.trigger("click");
    await flushPromises();

    const footerButtons = wrapper.findAll(
      ".api-key-admin-display .dialog-footer button",
    );
    await footerButtons[1]!.trigger("click");
    await flushPromises();
    expect(api.delete).not.toHaveBeenCalled();

    const confirmButton = wrapper
      .findAll(".inner-dialog button")
      .find((button) => button.text() === "Delete");
    await confirmButton?.trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith("/users/user-2/api-key");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
