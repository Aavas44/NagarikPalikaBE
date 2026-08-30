import { Router } from "express";
import mongoose from "mongoose";
import {
  requireAuth,
  requireSuperadmin,
  type AuthRequest,
} from "../middleware/auth";
import {
  LEGAL_CASE_DOCUMENT_KINDS,
  LEGAL_CASE_DOCUMENT_TITLES,
  type LegalCaseDocumentKind,
} from "../models/LegalCase";
import {
  SajiloKanunDocumentTemplate,
  sajiloKanunDocumentTemplateToJson,
  type ISkTemplateVariable,
} from "../models/SajiloKanunDocumentTemplate";
import { COURT_TYPE_META, parseCourtType } from "../lib/court-type";
import { buildTemplateNameRoman } from "../lib/nepali-romanize";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import { mergeTemplateVariables } from "../services/ward-variable-presets";
import {
  removeSkTemplateFile,
  storeSkTemplateFile,
} from "../services/sk-template-storage";
import {
  overwriteSkTemplateDocxFromHtml,
  readSkTemplateFileBuffer,
  refreshSkTemplateVariablesFromDocx,
} from "../services/sk-template-content";

const router = Router();

router.use(requireAuth, requireSuperadmin);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseDocumentKind(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || !/^[a-z][a-z0-9_]*$/i.test(key)) return null;
  return key.toLowerCase();
}

function parseVariables(raw: unknown): ISkTemplateVariable[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const v = item as Record<string, unknown>;
      const key = typeof v.key === "string" ? v.key.trim() : "";
      if (!key || !/^[a-z][a-z0-9_]*$/i.test(key)) return null;
      const label =
        v.label && typeof v.label === "object"
          ? (v.label as { en?: string; ne?: string })
          : null;
      const labelEn =
        typeof label?.en === "string"
          ? label.en.trim()
          : typeof v.labelEn === "string"
            ? v.labelEn.trim()
            : key;
      const labelNe =
        typeof label?.ne === "string"
          ? label.ne.trim()
          : typeof v.labelNe === "string"
            ? v.labelNe.trim()
            : "";
      const type = v.type === "date" || v.type === "number" ? v.type : "text";
      return {
        key,
        labelEn,
        labelNe,
        type,
        required: v.required !== false,
      };
    })
    .filter(Boolean) as ISkTemplateVariable[];
}

function decodeBase64File(data: string): Buffer {
  const trimmed = data.trim();
  const base64 = trimmed.includes(",")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Empty file data");
  return buffer;
}

router.get("/sajilo-kanun-templates/meta", async (_req, res) => {
  res.json({
    courtTypes: Object.entries(COURT_TYPE_META).map(([id, meta]) => ({
      id,
      labelNe: meta.labelNe,
      labelEn: meta.labelEn,
    })),
    documentKinds: LEGAL_CASE_DOCUMENT_KINDS.map((kind) => ({
      id: kind,
      title: LEGAL_CASE_DOCUMENT_TITLES[kind],
    })),
  });
});

router.get("/sajilo-kanun-templates", async (_req, res) => {
  try {
    const templates = await SajiloKanunDocumentTemplate.find().sort({
      courtType: 1,
      documentKind: 1,
      createdAt: -1,
    });
    res.json(templates.map(sajiloKanunDocumentTemplateToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list Sajilo Kanun templates" });
  }
});

router.post("/sajilo-kanun-templates", async (req: AuthRequest, res) => {
  try {
    const {
      nameEn,
      nameNe,
      nameRoman,
      descriptionEn,
      descriptionNe,
      courtType: courtTypeRaw,
      documentKind: documentKindRaw,
      variables,
      status,
      fileName,
      fileData,
    } = req.body as {
      nameEn?: string;
      nameNe?: string;
      nameRoman?: string;
      descriptionEn?: string;
      descriptionNe?: string;
      courtType?: string;
      documentKind?: string;
      variables?: unknown;
      status?: "draft" | "published";
      fileName?: string;
      fileData?: string;
    };

    const courtType = parseCourtType(courtTypeRaw);
    const documentKind = parseDocumentKind(documentKindRaw);

    if (!nameEn?.trim() || !fileName?.trim() || !fileData?.trim()) {
      res.status(400).json({
        error: "Template name, file name, and file data are required",
      });
      return;
    }
    if (!courtType || !documentKind) {
      res.status(400).json({
        error: "Court type and document kind are required",
      });
      return;
    }

    const baseSlug =
      slugify(
        `${courtType}-${documentKind}-${nameEn}`
      ) || `sk-template-${Date.now()}`;
    let slug = baseSlug;
    let suffix = 1;
    while (await SajiloKanunDocumentTemplate.exists({ slug })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const buffer = decodeBase64File(fileData);
    const stored = await storeSkTemplateFile(fileName, buffer);
    const detectedKeys =
      stored.fileType === "docx" ? extractPlaceholdersFromDocx(buffer) : [];

    const template = await SajiloKanunDocumentTemplate.create({
      slug,
      nameEn: nameEn.trim(),
      nameNe: nameNe?.trim() ?? "",
      nameRoman:
        nameRoman?.trim() ||
        buildTemplateNameRoman(nameNe?.trim() ?? "", nameEn.trim()),
      descriptionEn: descriptionEn?.trim() ?? "",
      descriptionNe: descriptionNe?.trim() ?? "",
      courtType,
      documentKind,
      variables: mergeTemplateVariables(parseVariables(variables), detectedKeys),
      fileType: stored.fileType,
      storageKey: stored.storageKey,
      originalFileName: fileName.trim(),
      status: status === "published" ? "published" : "draft",
      createdBy: new mongoose.Types.ObjectId(req.user!.id),
    });

    res.status(201).json(sajiloKanunDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create template",
    });
  }
});

router.get("/sajilo-kanun-templates/:id/file", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await SajiloKanunDocumentTemplate.findById(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (template.fileType !== "docx") {
      res.status(400).json({
        error: "Only DOCX templates can be edited in the browser",
      });
      return;
    }

    const buffer = await readSkTemplateFileBuffer(template.storageKey);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(template.originalFileName)}"`
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load template file",
    });
  }
});

router.put("/sajilo-kanun-templates/:id/content", async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await SajiloKanunDocumentTemplate.findById(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (template.fileType !== "docx") {
      res.status(400).json({
        error: "Only DOCX templates can be edited in the browser",
      });
      return;
    }

    const { content } = req.body as { content?: unknown };
    if (typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const buffer = await overwriteSkTemplateDocxFromHtml(
      template.storageKey,
      content
    );
    template.variables = refreshSkTemplateVariablesFromDocx(
      template.variables,
      buffer
    );
    await template.save();

    res.json(sajiloKanunDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save template content",
    });
  }
});

router.patch("/sajilo-kanun-templates/:id", async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await SajiloKanunDocumentTemplate.findById(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    if (typeof body.nameEn === "string" && body.nameEn.trim()) {
      template.nameEn = body.nameEn.trim();
    }
    if (typeof body.nameNe === "string") template.nameNe = body.nameNe.trim();
    if (typeof body.nameRoman === "string") {
      template.nameRoman = body.nameRoman.trim();
    } else if (
      typeof body.nameEn === "string" ||
      typeof body.nameNe === "string"
    ) {
      template.nameRoman = buildTemplateNameRoman(
        template.nameNe,
        template.nameEn
      );
    }
    if (typeof body.descriptionEn === "string") {
      template.descriptionEn = body.descriptionEn.trim();
    }
    if (typeof body.descriptionNe === "string") {
      template.descriptionNe = body.descriptionNe.trim();
    }
    if (body.status === "draft" || body.status === "published") {
      template.status = body.status;
    }
    const nextCourtType = parseCourtType(body.courtType);
    if (body.courtType !== undefined) {
      if (!nextCourtType) {
        res.status(400).json({ error: "Invalid court type" });
        return;
      }
      template.courtType = nextCourtType;
    }
    const nextKind = parseDocumentKind(body.documentKind);
    if (body.documentKind !== undefined) {
      if (!nextKind) {
        res.status(400).json({ error: "Invalid document kind" });
        return;
      }
      template.documentKind = nextKind;
    }
    if (body.variables !== undefined) {
      template.variables = parseVariables(body.variables);
    }

    const replacingFile =
      typeof body.fileName === "string" &&
      typeof body.fileData === "string" &&
      body.fileName.trim() &&
      body.fileData.trim();

    if (replacingFile) {
      const buffer = decodeBase64File(body.fileData as string);
      const stored = await storeSkTemplateFile(body.fileName as string, buffer);
      await removeSkTemplateFile(template.storageKey);
      template.storageKey = stored.storageKey;
      template.fileType = stored.fileType;
      template.originalFileName = (body.fileName as string).trim();
      if (stored.fileType === "docx") {
        template.variables = refreshSkTemplateVariablesFromDocx(
          template.variables,
          buffer
        );
      } else {
        template.variables = [];
      }
    }

    await template.save();
    res.json(sajiloKanunDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update template",
    });
  }
});

router.delete("/sajilo-kanun-templates/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await SajiloKanunDocumentTemplate.findByIdAndDelete(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    await removeSkTemplateFile(template.storageKey);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
