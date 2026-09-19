// Project hierarchy helpers: the hierarchy lives in the project name using
// "/" as the separator (e.g. "Home/Parents"), with no parent reference
// stored on a project. Pure functions so the store, the tree select and the
// admin surfaces all share one implementation.

export interface HierarchyProject {
  id: string;
  name: string;
  archived: boolean;
}

export interface ProjectTreeNode {
  project: HierarchyProject;
  children: ProjectTreeNode[];
  depth: number;
  /** True when the parent path does not exist as a project. */
  orphan: boolean;
}

/** Splits a stored project name into its path segments. */
export function pathSegments(name: string): string[] {
  return (name || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Storage-canonical name: trimmed segments, empty ones dropped, rejoined. */
export function normalizeName(name: string): string {
  return pathSegments(name).join("/");
}

/** Display form: segments joined with " / ". */
export function displayName(name: string): string {
  return pathSegments(name).join(" / ");
}

/** Last segment — the label shown for a node inside a tree. */
export function leafName(name: string): string {
  const segments = pathSegments(name);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

/** The path of the parent project, or "" for a root. */
export function parentPath(name: string): string {
  const segments = pathSegments(name);
  return segments.slice(0, -1).join("/");
}

/** True path-prefix match: "Homework" is not a descendant of "Home". */
export function isDescendantName(name: string, ancestorName: string): boolean {
  if (!ancestorName) {
    return false;
  }
  return name.startsWith(ancestorName + "/");
}

/**
 * Builds the project tree from the flat project list. Projects whose parent
 * path is missing render at the root flagged as orphans. Roots keep the
 * incoming order (the API returns active projects first, archived last);
 * the same applies within a parent's children.
 */
export function buildProjectTree(
  projects: HierarchyProject[],
): ProjectTreeNode[] {
  const byPath = new Map<string, ProjectTreeNode>();
  const nodes = projects.map((project) => {
    const node: ProjectTreeNode = {
      project,
      children: [],
      depth: 0,
      orphan: false,
    };
    byPath.set(normalizeName(project.name).toLowerCase(), node);
    return node;
  });

  const roots: ProjectTreeNode[] = [];
  for (const node of nodes) {
    const parentKey = parentPath(node.project.name).toLowerCase();
    if (parentKey && byPath.has(parentKey)) {
      const parent = byPath.get(parentKey)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      // No parent path (root) or the parent project is missing (orphan):
      // both render at the root, the latter with a warning flag
      node.orphan = parentKey !== "";
      roots.push(node);
    }
  }

  return roots;
}

/** Flattens a tree in display order (parent before its children). */
export function flattenProjectTree(
  roots: ProjectTreeNode[],
): ProjectTreeNode[] {
  const out: ProjectTreeNode[] = [];
  for (const root of roots) {
    flattenInto(root, out);
  }
  return out;
}

function flattenInto(node: ProjectTreeNode, out: ProjectTreeNode[]): void {
  out.push(node);
  for (const child of node.children) {
    flattenInto(child, out);
  }
}

/**
 * Whether a normalized project name is already used by another project
 * (case-insensitive). Project mutations are admin-only, so validating at
 * the admin surfaces covers every rename/create.
 */
export function isNameTakenIn(
  projects: HierarchyProject[],
  name: string,
  excludeId?: string,
): boolean {
  const normalized = normalizeName(name).toLowerCase();
  if (!normalized) {
    return false;
  }
  return projects.some(
    (p) => p.id !== excludeId && normalizeName(p.name).toLowerCase() === normalized,
  );
}

/**
 * Rewrites a descendant name for a rename cascade: keeps everything after
 * the old parent path and grafts it onto the new one.
 */
export function cascadeRenameName(
  oldParentName: string,
  newParentName: string,
  descendantName: string,
): string {
  const oldBase = normalizeName(oldParentName);
  const newBase = normalizeName(newParentName);
  const suffix = normalizeName(descendantName).slice(oldBase.length);
  return newBase + suffix;
}
