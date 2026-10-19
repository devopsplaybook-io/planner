import { describe, expect, it } from "vitest";
import { groupTemplatesByProject } from "./templateGroups";
import type { TaskTemplate } from "../stores/taskTemplates";

function template(id: string, projectId: string, title: string): TaskTemplate {
  return {
    id,
    projectId,
    title,
    description: "",
    priority: "medium",
    checklist: [],
    automation: {
      scheduleCron: null,
      skipIfPreviousNotDone: false,
      addDateToTitle: false,
      instanceStatus: null,
    },
    assignees: [],
    comments: [],
    attachments: [],
    labels: [],
    dateCreated: "",
    dateUpdated: "",
  };
}

const projects = [
  { id: "p-home", name: "Home/Chores" },
  { id: "p-work", name: "Work" },
];

describe("groupTemplatesByProject", () => {
  it("sorts templates by title, case-insensitively", () => {
    const groups = groupTemplatesByProject(
      [
        template("1", "p-work", "beta report"),
        template("2", "p-work", "Alpha checklist"),
        template("3", "p-work", "alpha budget"),
      ],
      projects,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.templates.map((t) => t.title)).toEqual([
      "alpha budget",
      "Alpha checklist",
      "beta report",
    ]);
  });

  it("groups templates per project with display-name labels", () => {
    const groups = groupTemplatesByProject(
      [
        template("1", "p-home", "Weekly chores"),
        template("2", "p-work", "Weekly report"),
        template("3", "p-home", "Deep clean"),
      ],
      projects,
    );
    expect(groups.map((g) => g.label)).toEqual(["Home / Chores", "Work"]);
    expect(groups[0]?.key).toBe("p-home");
    expect(groups[0]?.templates.map((t) => t.id)).toEqual(["3", "1"]);
    expect(groups[1]?.templates.map((t) => t.id)).toEqual(["2"]);
  });

  it("orders groups alphabetically by label regardless of input order", () => {
    const groups = groupTemplatesByProject(
      [template("1", "p-work", "Report"), template("2", "p-home", "Chores")],
      projects,
    );
    expect(groups.map((g) => g.key)).toEqual(["p-home", "p-work"]);
  });

  it("falls back to 'Unknown project' for a missing project", () => {
    const groups = groupTemplatesByProject(
      [template("1", "p-gone", "Orphan")],
      projects,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Unknown project");
    expect(groups[0]?.templates.map((t) => t.id)).toEqual(["1"]);
  });

  it("keeps equal titles in input order (stable sort)", () => {
    const groups = groupTemplatesByProject(
      [
        template("1", "p-work", "Same"),
        template("2", "p-work", "same"),
        template("3", "p-work", "SAME"),
      ],
      projects,
    );
    expect(groups[0]?.templates.map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("returns an empty array for an empty list", () => {
    expect(groupTemplatesByProject([], projects)).toEqual([]);
  });
});
