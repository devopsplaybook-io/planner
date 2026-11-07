// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import DictationPhrasesEditor from "./DictationPhrasesEditor.vue";

interface Phrase {
  id: string;
  phrase: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
  dateCreated: string;
}

interface PhrasesStoreStub {
  phrases: Phrase[];
  loading: boolean;
  error: string | null;
  readonly count: number;
  fetchAll: Mock;
  add: Mock;
  remove: Mock;
}

interface ProjectsStoreStub {
  projects: { id: string; name: string }[];
  activeProjects: { id: string; name: string }[];
  fetchAll: Mock;
}

interface TemplatesStoreStub {
  templates: { id: string; title: string }[];
  fetchAll: Mock;
}

const projectPhrase: Phrase = {
  id: "ph1",
  phrase: "new bug report",
  projectId: "p1",
  templateId: null,
  labels: ["bug", "triage"],
  dateCreated: "",
};
const templatePhrase: Phrase = {
  id: "ph2",
  phrase: "weekly review",
  projectId: null,
  templateId: "tpl1",
  labels: [],
  dateCreated: "",
};

let phrasesStore: PhrasesStoreStub;
let projectsStore: ProjectsStoreStub;
let templatesStore: TemplatesStoreStub;

function makePhrasesStore(phrases: Phrase[] = []): PhrasesStoreStub {
  const store: PhrasesStoreStub = reactive({
    phrases,
    loading: false,
    error: null,
    get count() {
      return store.phrases.length;
    },
    fetchAll: vi.fn(async () => ({})),
    add: vi.fn(async (input: Omit<Phrase, "id" | "dateCreated">) => {
      const added: Phrase = { id: `new-${store.phrases.length}`, ...input, dateCreated: "" };
      store.phrases = [...store.phrases, added];
      return { phrase: added };
    }),
    remove: vi.fn(async (id: string) => {
      store.phrases = store.phrases.filter((phrase) => phrase.id !== id);
      return {};
    }),
  });
  return store;
}

function mountEditor() {
  return mount(DictationPhrasesEditor);
}

beforeEach(() => {
  phrasesStore = makePhrasesStore([projectPhrase, templatePhrase]);
  projectsStore = {
    projects: [
      { id: "p1", name: "Planner" },
      { id: "p2", name: "Website" },
    ],
    activeProjects: [
      { id: "p1", name: "Planner" },
      { id: "p2", name: "Website" },
    ],
    fetchAll: vi.fn(async () => undefined),
  };
  templatesStore = {
    templates: [{ id: "tpl1", title: "Weekly review" }],
    fetchAll: vi.fn(async () => undefined),
  };
  vi.stubGlobal("useDictationPhrasesStore", () => phrasesStore);
  vi.stubGlobal("useProjectsStore", () => projectsStore);
  vi.stubGlobal("useTaskTemplatesStore", () => templatesStore);
  vi.stubGlobal("useRecommendationStore", () => ({
    dictationPhrasesMax: 50,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DictationPhrasesEditor", () => {
  it("should load and list the phrases with their targets", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    expect(phrasesStore.fetchAll).toHaveBeenCalledTimes(1);
    expect(projectsStore.fetchAll).toHaveBeenCalledTimes(1);
    expect(templatesStore.fetchAll).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".phrases-count").text()).toBe("2 / 50 phrases");

    const items = wrapper.findAll(".phrase-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.find(".phrase-text").text()).toContain("new bug report");
    expect(items[0]!.find(".phrase-target").text()).toBe("Project: Planner");
    expect(items[0]!.find(".phrase-labels").text()).toBe("bug, triage");
    expect(items[1]!.find(".phrase-target").text()).toBe(
      "Template: Weekly review",
    );
  });

  it("should explain when there are no phrases yet", async () => {
    phrasesStore = makePhrasesStore([]);
    vi.stubGlobal("useDictationPhrasesStore", () => phrasesStore);

    const wrapper = mountEditor();
    await flushPromises();

    expect(wrapper.find(".setting-hint").text()).toContain("No phrases yet");
  });

  it("should add a project phrase with trimmed labels", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper
      .find('input[aria-label="New command phrase"]')
      .setValue("  new feature  ");
    await wrapper.find('select[aria-label="Phrase project"]').setValue("p2");
    await wrapper
      .find('input[aria-label="Phrase labels"]')
      .setValue(" feat , , ui ");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(phrasesStore.add).toHaveBeenCalledWith({
      phrase: "new feature",
      projectId: "p2",
      templateId: null,
      labels: ["feat", "ui"],
    });
    expect(wrapper.find(".phrases-feedback").text()).toBe("Phrase added.");
    expect(wrapper.findAll(".phrase-item")).toHaveLength(3);
  });

  it("should add a template phrase without labels", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper
      .find('input[aria-label="New command phrase"]')
      .setValue("weekly review");
    await wrapper
      .find('select[aria-label="Phrase target type"]')
      .setValue("template");
    await wrapper.find('select[aria-label="Phrase template"]').setValue("tpl1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(phrasesStore.add).toHaveBeenCalledWith({
      phrase: "weekly review",
      projectId: null,
      templateId: "tpl1",
      labels: [],
    });
  });

  it("should disable adding until a phrase and a target are chosen", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    const add = () => wrapper.find('button[type="submit"]');
    expect(add().attributes("disabled")).toBeDefined();

    await wrapper
      .find('input[aria-label="New command phrase"]')
      .setValue("new feature");
    expect(add().attributes("disabled")).toBeDefined();

    await wrapper.find('select[aria-label="Phrase project"]').setValue("p1");
    expect(add().attributes("disabled")).toBeUndefined();
  });

  it("should surface an inline error", async () => {
    phrasesStore.add.mockResolvedValue({
      error: "This phrase already exists",
    });
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper
      .find('input[aria-label="New command phrase"]')
      .setValue("new bug report");
    await wrapper.find('select[aria-label="Phrase project"]').setValue("p1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".phrases-feedback").text()).toBe(
      "This phrase already exists",
    );
    expect(wrapper.find(".phrases-feedback").classes()).toContain("is-error");
  });

  it("should remove a phrase", async () => {
    const wrapper = mountEditor();
    await flushPromises();

    await wrapper
      .find('.phrase-remove[aria-label="Remove new bug report"]')
      .trigger("click");
    await flushPromises();

    expect(phrasesStore.remove).toHaveBeenCalledWith("ph1");
    expect(wrapper.findAll(".phrase-item")).toHaveLength(1);
  });

  it("should disable adding at the server limit", async () => {
    phrasesStore = makePhrasesStore(
      Array.from({ length: 50 }, (_, index) => ({
        id: `p-${index}`,
        phrase: `phrase ${index}`,
        projectId: "p1",
        templateId: null,
        labels: [],
        dateCreated: "",
      })),
    );
    vi.stubGlobal("useDictationPhrasesStore", () => phrasesStore);

    const wrapper = mountEditor();
    await flushPromises();

    await wrapper
      .find('input[aria-label="New command phrase"]')
      .setValue("one too many");
    await wrapper.find('select[aria-label="Phrase project"]').setValue("p1");

    expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find(".phrases-count").text()).toBe("50 / 50 phrases");
  });
});
