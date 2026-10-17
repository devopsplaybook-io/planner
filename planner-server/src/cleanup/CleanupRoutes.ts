import { FastifyInstance, RequestGenericInterface } from "fastify";
import { ProjectsDataList } from "../projects/ProjectsData";
import { SettingsDataGet, SettingsDataSave } from "../settings/SettingsData";
import { AuthMustBeAdmin } from "../users/Auth";
import {
  CLEANUP_SETTINGS_CATEGORY,
  CleanupRule,
  ParseCleanupRules,
  ValidateCleanupRules,
} from "./CleanupRules";
import { CleanupPreviewRules } from "./CleanupScheduler";

export class CleanupRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // ==================== GET RULES (Admin only) ====================
    fastify.get("/rules", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const rules = await loadStoredRules();
      return res.status(200).send({ rules });
    });

    // ==================== SAVE RULES (Admin only) ====================
    interface PutRules extends RequestGenericInterface {
      Body: { rules: unknown };
    }
    fastify.put<PutRules>("/rules", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const projectIds = new Set((await ProjectsDataList()).map((p) => p.id));
      const { rules, error } = ValidateCleanupRules(
        req.body?.rules,
        projectIds,
      );
      if (error || rules === null) {
        return res.status(400).send({ error: error || "Invalid rules" });
      }
      await SettingsDataSave(
        CLEANUP_SETTINGS_CATEGORY,
        JSON.stringify({ rules }),
      );
      return res.status(201).send({ rules });
    });

    // ==================== DRY-RUN PREVIEW (Admin only) ====================
    interface PostPreview extends RequestGenericInterface {
      Body: { rules: unknown };
    }
    fastify.post<PostPreview>("/preview", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      // The body carries the edited, not-yet-saved rules so the preview
      // works before the first save
      const projectIds = new Set((await ProjectsDataList()).map((p) => p.id));
      const { rules, error } = ValidateCleanupRules(
        req.body?.rules,
        projectIds,
      );
      if (error || rules === null) {
        return res.status(400).send({ error: error || "Invalid rules" });
      }
      const projects = await CleanupPreviewRules(rules);
      return res.status(200).send({ projects });
    });
  }
}

async function loadStoredRules(): Promise<CleanupRule[]> {
  let raw: string | null = null;
  try {
    raw = await SettingsDataGet(CLEANUP_SETTINGS_CATEGORY);
  } catch {
    return [];
  }
  if (raw === null || !raw.trim()) {
    return [];
  }
  try {
    return ParseCleanupRules(JSON.parse(raw));
  } catch {
    return [];
  }
}
