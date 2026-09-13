import { ProjectsDataList } from "../projects/ProjectsData";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";

export interface StatusCatalogEntry {
  name: string;
  color: string;
}

/** Color applied to statuses without an explicitly chosen one (gray). */
export const DEFAULT_STATUS_COLOR = "#6b7280";

/** Colors of the canonical statuses on a fresh installation. */
const STATUS_SEED_COLORS: Record<string, string> = {
  "To Do": "#3b82f6",
  "In Progress": "#f59e0b",
  Done: "#22c55e",
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidStatusColor(color: unknown): color is string {
  return typeof color === "string" && HEX_COLOR_PATTERN.test(color);
}

/**
 * Normalize raw stored JSON into the current catalog shape. Legacy entries
 * (plain status names) and entries without a valid color get the default
 * gray color, since colors are mandatory — no SQL migration needed, the
 * normalized shape is re-persisted on the next admin save.
 */
export function normalizeStatusCatalog(parsed: unknown): StatusCatalogEntry[] {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: StatusCatalogEntry[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (entry.trim()) {
        entries.push({ name: entry, color: DEFAULT_STATUS_COLOR });
      }
    } else if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as { name?: unknown }).name === "string" &&
      (entry as { name: string }).name.trim()
    ) {
      const { name, color } = entry as { name: string; color: unknown };
      entries.push({
        name,
        color: isValidStatusColor(color) ? color : DEFAULT_STATUS_COLOR,
      });
    }
  }
  return entries;
}

export async function StatusesCatalogGet(): Promise<StatusCatalogEntry[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_STATUSES[DbUtilsGetType()],
    [],
  );
  if (rows.length === 0 || !rows[0].statuses) {
    return [];
  }
  try {
    return normalizeStatusCatalog(JSON.parse(rows[0].statuses as string));
  } catch {
    return [];
  }
}

export async function StatusesCatalogSet(
  statuses: StatusCatalogEntry[],
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.UPSERT_STATUSES[DbUtilsGetType()], [
    JSON.stringify(statuses),
    new Date().toISOString(),
  ]);
}

/**
 * Seed the status catalog when it is empty (fresh database or first start
 * after this feature ships). The canonical statuses come first, any other
 * statuses already used by existing projects are preserved, and "Done" is
 * forced last: standard projects end up with To Do, In Progress, Done.
 */
export function seedStatusOrder(
  projectStatusLists: string[][],
): StatusCatalogEntry[] {
  const result: StatusCatalogEntry[] = [];
  const push = (name: string) => {
    if (name && !result.some((s) => s.name === name)) {
      result.push({
        name,
        color: STATUS_SEED_COLORS[name] ?? DEFAULT_STATUS_COLOR,
      });
    }
  };
  push("To Do");
  push("In Progress");
  for (const list of projectStatusLists) {
    for (const status of list) {
      push(status);
    }
  }
  push("Done");
  return result;
}

export async function StatusesCatalogSeedIfEmpty(): Promise<void> {
  const current = await StatusesCatalogGet();
  if (current.length > 0) {
    return;
  }
  const projects = await ProjectsDataList();
  await StatusesCatalogSet(seedStatusOrder(projects.map((p) => p.statuses)));
}

const SQL_QUERIES = {
  GET_STATUSES: {
    postgres: "SELECT * FROM statuses WHERE id = 1",
    sqlite: "SELECT * FROM statuses WHERE id = 1",
  },
  UPSERT_STATUSES: {
    postgres:
      'INSERT INTO statuses (id, statuses, "dateUpdated") VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET statuses = EXCLUDED.statuses, "dateUpdated" = EXCLUDED."dateUpdated"',
    sqlite:
      "INSERT INTO statuses (id, statuses, dateUpdated) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET statuses = excluded.statuses, dateUpdated = excluded.dateUpdated",
  },
};
