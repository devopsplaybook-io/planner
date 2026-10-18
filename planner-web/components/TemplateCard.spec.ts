// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import TemplateCard from "./TemplateCard.vue";
import { useProjectsStore } from "../stores/projects";

const project = {
  id: "project-1",
  name: "Home/Chores",
  description: "",
  isDefault: false,
  archived: false,
  visibility: "public",
  userAccess: [],
  statuses: ["To Do", "Done"],
};

const template = {
  id: "template-1",
  projectId: "project-1",
  title: "Weekly report",
  description: "",
  priority: "high",
  checklist: [
    { text: "Collect numbers", done: true },
    { text: "Write summary", done: false },
  ],
  automation: {
    scheduleCron: null,
    skipIfPreviousNotDone: true,
    addDateToTitle: false,
    instanceStatus: null,
  },
  assignees: [{ userId: "user-1" }, { userId: "user-2" }],
  comments: [{ id: "comment-1" }],
  attachments: [{ id: "att-1" }, { id: "att-2" }],
  labels: ["ops", "weekly"],
  dateCreated: "",
  dateUpdated: "",
};

function mountCard(overrides = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectsStore = useProjectsStore(pinia);
  projectsStore.projects = [project];
  return mount(TemplateCard, {
    props: { template: { ...template, ...overrides } },
    global: { plugins: [pinia] },
  });
}

describe("TemplateCard", () => {
  it("should render the title, project name and labels", () => {
    const wrapper = mountCard();
    expect(wrapper.find(".item-title").text()).toBe("Weekly report");
    expect(wrapper.find(".project-name").text()).toBe("Home / Chores");
    const labels = wrapper.findAll(".label-tag");
    expect(labels.map((l) => l.text())).toEqual(["ops", "weekly"]);
  });

  it("should show a Manual automation chip when no cron is set", () => {
    const wrapper = mountCard();
    expect(wrapper.find(".automation-chip").text()).toBe("Manual");
  });

  it("should show the human cron label when a schedule is set", () => {
    const wrapper = mountCard({
      automation: {
        scheduleCron: "0 0 * * *",
        skipIfPreviousNotDone: false,
        addDateToTitle: false,
        instanceStatus: null,
      },
    });
    expect(wrapper.find(".automation-chip").text()).toBe(
      "Every day at 00:00",
    );
    expect(wrapper.find(".skip-flag").exists()).toBe(false);
  });

  it("should render the initial-status chip when an instanceStatus is set", () => {
    const wrapper = mountCard({
      automation: {
        scheduleCron: null,
        skipIfPreviousNotDone: false,
        addDateToTitle: false,
        instanceStatus: "Doing",
      },
    });
    const chip = wrapper.find(".initial-status-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Doing");
    expect(chip.attributes("title")).toBe("Instances start in Doing");
  });

  it("should not render the initial-status chip without an instanceStatus", () => {
    const wrapper = mountCard();
    expect(wrapper.find(".initial-status-chip").exists()).toBe(false);
  });

  it("should render the meta counts and the skips-open flag", () => {
    const wrapper = mountCard();
    expect(wrapper.find(".checklist-progress").text().trim()).toBe("1/2");
    expect(wrapper.find(".assignee-count").text().trim()).toBe("2");
    expect(wrapper.find(".attachment-count").text().trim()).toBe("2");
    expect(wrapper.find(".comment-count").text().trim()).toBe("1");
    expect(wrapper.find(".skip-flag").exists()).toBe(true);
  });

  it("should carry the priority class for the accent stripe", () => {
    const wrapper = mountCard();
    expect(wrapper.find(".template-card").classes()).toContain("priority-high");
  });

  it("should emit click with the template on card click", async () => {
    const wrapper = mountCard();
    await wrapper.find(".template-card").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
    expect(wrapper.emitted("click")![0]).toEqual([template]);
  });

  it("should not render any action buttons", () => {
    const wrapper = mountCard();
    expect(wrapper.findAll("button")).toHaveLength(0);
  });
});
