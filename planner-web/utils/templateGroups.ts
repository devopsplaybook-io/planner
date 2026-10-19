import { displayName } from "./projectHierarchy";
import type { TaskTemplate } from "../stores/taskTemplates";

export interface TemplateProjectGroup {
  /** Project id of the group: stable key for rendering. */
  key: string;
  /** Full display path of the project (e.g. "Home / Chores"). */
  label: string;
  /** Templates of the project, alphabetical by title. */
  templates: TaskTemplate[];
}

/** Case-insensitive, locale-aware string comparison. */
const compareInsensitive = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * Sorts templates alphabetically by title (case-insensitive) and buckets
 * them per project: one group per project, groups ordered alphabetically by
 * their display label. A stable sort keeps the server's newest-first order
 * for equal titles. The "Unknown project" fallback is defensive only: the
 * tab fetches the projects before the templates, so the lookup normally
 * always succeeds.
 */
export function groupTemplatesByProject(
  templates: TaskTemplate[],
  projects: { id: string; name: string }[],
): TemplateProjectGroup[] {
  const buckets = new Map<string, TaskTemplate[]>();
  for (const template of [...templates].sort((a, b) =>
    compareInsensitive(a.title, b.title),
  )) {
    const bucket = buckets.get(template.projectId);
    if (bucket) {
      bucket.push(template);
    } else {
      buckets.set(template.projectId, [template]);
    }
  }
  return [...buckets.entries()]
    .map(([key, groupTemplates]) => {
      const project = projects.find((p) => p.id === key);
      return {
        key,
        label: project ? displayName(project.name) : "Unknown project",
        templates: groupTemplates,
      };
    })
    .sort((a, b) => compareInsensitive(a.label, b.label));
}
