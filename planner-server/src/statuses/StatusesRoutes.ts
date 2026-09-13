import { FastifyInstance, RequestGenericInterface } from "fastify";
import { ProjectsDataList } from "../projects/ProjectsData";
import { AuthMustBeAdmin, AuthMustBeAuthenticated } from "../users/Auth";
import {
  isValidStatusColor,
  StatusCatalogEntry,
  StatusesCatalogGet,
  StatusesCatalogSet,
} from "./StatusesData";

export function validateStatusCatalog(
  statuses: StatusCatalogEntry[],
): string | null {
  if (!Array.isArray(statuses) || statuses.length < 2) {
    return "At least 2 statuses are required";
  }
  const isNamedEntry = (s: unknown): s is StatusCatalogEntry =>
    s !== null &&
    typeof s === "object" &&
    !Array.isArray(s) &&
    typeof (s as { name?: unknown }).name === "string" &&
    !!(s as { name: string }).name.trim();
  if (!statuses.every(isNamedEntry)) {
    return "All statuses must be objects with a non-empty name";
  }
  if (!statuses.every((s) => isValidStatusColor(s.color))) {
    return "Each status color must be a valid hex color code (#RRGGBB)";
  }
  const names = statuses.map((s) => s.name);
  if (new Set(names).size !== names.length) {
    return "Duplicate statuses are not allowed";
  }
  if (!names.includes("Done")) {
    return '"Done" must be included';
  }
  if (names[names.length - 1] !== "Done") {
    return '"Done" must be the last status';
  }
  return null;
}

export function removedStatusesInUse(
  current: StatusCatalogEntry[],
  next: StatusCatalogEntry[],
  projectStatusLists: string[][],
): string[] {
  const removed = current.filter((s) => !next.some((n) => n.name === s.name));
  const inUse = new Set<string>();
  for (const list of projectStatusLists) {
    for (const status of list) {
      if (removed.some((s) => s.name === status)) {
        inUse.add(status);
      }
    }
  }
  return [...inUse];
}

export class StatusesRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== GET (Authenticated users) ====================
    fastify.get("/", async (req, res) => {
      try {
        await AuthMustBeAuthenticated(req, res);
      } catch {
        return;
      }
      return res.status(200).send({ statuses: await StatusesCatalogGet() });
    });

    // ==================== REPLACE (Admin only) ====================
    interface PutStatuses extends RequestGenericInterface {
      Body: { statuses: StatusCatalogEntry[] };
    }
    fastify.put<PutStatuses>("/", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const validationError = validateStatusCatalog(req.body?.statuses);
      if (validationError) {
        return res.status(400).send({ error: validationError });
      }
      const current = await StatusesCatalogGet();
      const projects = await ProjectsDataList();
      const inUse = removedStatusesInUse(
        current,
        req.body.statuses,
        projects.map((p) => p.statuses),
      );
      if (inUse.length > 0) {
        return res.status(400).send({
          error: `Status still used by projects: ${inUse.join(", ")}`,
        });
      }
      await StatusesCatalogSet(req.body.statuses);
      return res.status(201).send({ statuses: req.body.statuses });
    });
  }
}
