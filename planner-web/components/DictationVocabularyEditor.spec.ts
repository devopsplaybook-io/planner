// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import DictationVocabularyEditor from "./DictationVocabularyEditor.vue";

interface VocabularyTerm {
  id: string;
  term: string;
  projectId: string | null;
  dateCreated: string;
}

interface VocabularyStoreStub {
  terms: VocabularyTerm[];
  loading: boolean;
  error: string | null;
  readonly count: number;
  termsFor: (projectId: string | null) => VocabularyTerm[];
  fetchAll: Mock;
  add: Mock;
  remove: Mock;
  replaceScope: Mock;
}

interface ProjectsStoreStub {
  projects: { id: string; name: string; archived: boolean }[];
  activeProjects: { id: string; name: string; archived: boolean }[];
  fetchAll: Mock;
}

const personal: VocabularyTerm = {
  id: "v1",
  term: "Kubernetes",
  projectId: null,
  dateCreated: "2026-11-07T10:00:00.000Z",
};
const projectTerm: VocabularyTerm = {
  id: "v2",
  term: "xAuto",
  projectId: "p1",
  dateCreated: "2026-11-07T10:00:00.000Z",
};

let vocabularyStore: VocabularyStoreStub;
let projectsStore: ProjectsStoreStub;

function makeVocabularyStore(
  terms: VocabularyTerm[] = [personal, projectTerm],
): VocabularyStoreStub {
  const store: VocabularyStoreStub = reactive({
    terms,
    loading: false,
    error: null,
    get count() {
      return store.terms.length;
    },
    termsFor: (projectId: string | null) =>
      store.terms.filter(
        (term: { projectId: string | null }) =>
          (term.projectId ?? null) === (projectId ?? null),
      ),
    fetchAll: vi.fn(async () => ({})),
    add: vi.fn(async (term: string, projectId: string | null) => {
      const added = { id: "new", term, projectId, dateCreated: "" };
      store.terms = [...store.terms, added];
      return { term: added };
    }),
    remove: vi.fn(async (id: string) => {
      store.terms = store.terms.filter(
        (term: { id: string }) => term.id !== id,
      );
      return {};
    }),
    replaceScope: vi.fn(async (projectId: string | null, terms: string[]) => {
      const scoped = terms.map((term, index) => ({
        id: `i-${index}`,
        term,
        projectId,
        dateCreated: "",
      }));
      store.terms = [
        ...store.terms.filter(
          (term: { projectId: string | null }) =>
            (term.projectId ?? null) !== (projectId ?? null),
        ),
        ...scoped,
      ];
      return { terms: scoped };
    }),
  });
  return store;
}

beforeEach(() => {
  vocabularyStore = makeVocabularyStore();
  projectsStore = {
    projects: [
      { id: "p1", name: "Planner", archived: false },
      { id: "p2", name: "Archive", archived: true },
    ],
    activeProjects: [{ id: "p1", name: "Planner", archived: false }],
    fetchAll: vi.fn(async () => undefined),
  };
  vi.stubGlobal("useDictationVocabularyStore", () => vocabularyStore);
  vi.stubGlobal("useProjectsStore", () => projectsStore);
  vi.stubGlobal("useRecommendationStore", () => ({
    dictationVocabularyMax: 200,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DictationVocabularyEditor", () => {
  it("should list the personal terms and the project scopes", async () => {
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper.vm.$nextTick();

    const options = wrapper.findAll(".vocabulary-editor select option");
    expect(options.map((option) => option.text())).toEqual([
      "Personal",
      "Planner",
    ]);
    const chips = wrapper.findAll(".vocabulary-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toContain("Kubernetes");
  });

  it("should switch to a project scope", async () => {
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper.find(".vocabulary-editor select").setValue("p1");

    const chips = wrapper.findAll(".vocabulary-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toContain("xAuto");
  });

  it("should add a term to the selected scope", async () => {
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper
      .find('input[aria-label="New vocabulary term"]')
      .setValue("Grafana");
    await wrapper.find(".vocabulary-add").trigger("submit");

    expect(vocabularyStore.add).toHaveBeenCalledWith("Grafana", null);
    expect(wrapper.findAll(".vocabulary-chip")).toHaveLength(2);
    expect(wrapper.find(".vocabulary-feedback").text()).toContain("Grafana");
  });

  it("should remove a term", async () => {
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper.find('.vocabulary-remove[aria-label="Remove Kubernetes"]').trigger("click");

    expect(vocabularyStore.remove).toHaveBeenCalledWith("v1");
    expect(wrapper.findAll(".vocabulary-chip")).toHaveLength(0);
  });

  it("should import one term per line and replace the scope", async () => {
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper
      .find('textarea[aria-label="Terms to import"]')
      .setValue("Alpha\n\n  Beta  \nAlpha");
    const replace = wrapper
      .findAll("button")
      .find((button) => button.text() === "Replace scope");
    await replace!.trigger("click");

    expect(vocabularyStore.replaceScope).toHaveBeenCalledWith(null, [
      "Alpha",
      "Beta",
      "Alpha",
    ]);
  });

  it("should export the scope terms as plain text", async () => {
    const createObjectURL = vi.fn(() => "blob:vocabulary");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const wrapper = mount(DictationVocabularyEditor);
    const exportButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Export scope"));
    await exportButton!.trigger("click");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vocabulary");
    expect(wrapper.find(".vocabulary-feedback").text()).toContain("Exported 1");

    click.mockRestore();
  });

  it("should disable adding when the limit is reached", async () => {
    vocabularyStore = makeVocabularyStore([personal, projectTerm]);
    vocabularyStore.terms = Array.from({ length: 200 }, (_, index) => ({
      id: `t-${index}`,
      term: `term-${index}`,
      projectId: null,
      dateCreated: "",
    }));
    vi.stubGlobal("useDictationVocabularyStore", () => vocabularyStore);

    const wrapper = mount(DictationVocabularyEditor);
    await wrapper
      .find('input[aria-label="New vocabulary term"]')
      .setValue("Another");

    const add = wrapper
      .findAll("button")
      .find((button) => button.text() === "Add");
    expect(add!.attributes("disabled")).toBeDefined();
  });

  it("should surface an inline error", async () => {
    vocabularyStore.add.mockResolvedValue({
      error: "This term is already in the vocabulary",
    });
    const wrapper = mount(DictationVocabularyEditor);
    await wrapper
      .find('input[aria-label="New vocabulary term"]')
      .setValue("Kubernetes");
    await wrapper.find(".vocabulary-add").trigger("submit");

    expect(wrapper.find(".vocabulary-feedback").text()).toContain(
      "already in the vocabulary",
    );
  });
});
