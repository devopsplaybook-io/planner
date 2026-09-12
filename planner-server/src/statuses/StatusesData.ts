import { ProjectsDataList } from "../projects/ProjectsData";
import {
  DbUtilsExecSQL,
  DbUtilsGetType,
  DbUtilsQuerySQL,
} from "../utils/DbUtils";

export async function StatusesCatalogGet(): Promise<string[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_STATUSES[DbUtilsGetType()],
    [],
  );
  if (rows.length === 0 || !rows[0].statuses) {
    return [];
  }
  try {
    const parsed = JSON.parse(rows[0].statuses as string);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((s) => typeof s === "string");
  } catch {
    return [];
  }
}

export async function StatusesCatalogSet(statuses: string[]): Promise<void> {
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
export function seedStatusOrder(projectStatusLists: string[][]): string[] {
  const result: string[] = [];
  const push = (name: string) => {
    if (name && !result.includes(name)) {
      result.push(name);
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
