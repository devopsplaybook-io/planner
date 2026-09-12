import { FastifyInstance, RequestGenericInterface } from "fastify";
import { ProjectsDataList } from "../projects/ProjectsData";
import { AuthMustBeAdmin, AuthMustBeAuthenticated } from "../users/Auth";
import { StatusesCatalogGet, StatusesCatalogSet } from "./StatusesData";

export function validateStatusCatalog(statuses: string[]): string | null {
  if (!Array.isArray(statuses) || statuses.length < 2) {
    return "At least 2 statuses are required";
  }
  if (statuses.some((s) => typeof s !== "string" || !s.trim())) {
    return "All statuses must be non-empty strings";
  }
  if (new Set(statuses).size !== statuses.length) {
    return "Duplicate statuses are not allowed";
  }
  if (!statuses.includes("Done")) {
    return '"Done" must be included';
  }
  if (statuses[statuses.length - 1] !== "Done") {
    return '"Done" must be the last status';
  }
  return null;
}

export function removedStatusesInUse(
  current: string[],
  next: string[],
  projectStatusLists: string[][],
): string[] {
  const removed = current.filter((s) => !next.includes(s));
  const inUse = new Set<string>();
  for (const list of projectStatusLists) {
    for (const status of list) {
      if (removed.includes(status)) {
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
      Body: { statuses: string[] };
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
