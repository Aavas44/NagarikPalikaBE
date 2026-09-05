import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  requireAuth,
  requireSuperadmin,
  type AuthRequest,
} from "../middleware/auth";
import { User, userToJson } from "../models/User";
import {
  WardOperatorProfile,
  wardOperatorProfileToJson,
  type LocalBodyType,
} from "../models/WardOperatorProfile";
import {
  WardDocumentTemplate,
  wardDocumentTemplateToJson,
  type IWardTemplateVariable,
} from "../models/WardDocumentTemplate";
import {
  removeWardTemplateFile,
  storeWardTemplateFile,
} from "../services/ward-template-storage";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import {
  overwriteWardTemplateDocxFromHtml,
  readWardTemplateFileBuffer,
  refreshTemplateVariablesFromDocx,
} from "../services/ward-template-content";
import { mergeTemplateVariables } from "../services/ward-variable-presets";
import {
  isValidWardUsername,
  normalizeWardUsername,
  wardOperatorStorageEmail,
} from "../services/ward-operator-utils";
import { parseGenerationLimit } from "../services/ward-operator-quota";

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

function parseVariables(raw: unknown): IWardTemplateVariable[] {
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
      const type =
        v.type === "date" || v.type === "number" ? v.type : "text";
      return {
        key,
        labelEn,
        labelNe,
        type,
        required: v.required !== false,
      };
    })
    .filter(Boolean) as IWardTemplateVariable[];
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

router.get("/ward-operators", async (_req, res) => {
  try {
    const profiles = await WardOperatorProfile.find().sort({ createdAt: -1 });
    const userIds = profiles.map((p) => p.userId);
    const users = await User.find({ _id: { $in: userIds } });
    const userById = new Map(users.map((u) => [u._id.toString(), userToJson(u)]));
    res.json(
      profiles.map((p) =>
        wardOperatorProfileToJson(p, userById.get(p.userId.toString()) ?? null)
      )
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list ward operators" });
  }
});

router.post("/ward-operators", async (req: AuthRequest, res) => {
  try {
    const {
      username,
      email,
      password,
      operatorName,
      districtName,
      wardNo,
      localBodyType,
      localBodyName,
      formerLocalBodyType,
      formerLocalBodyName,
      formerWardNo,
      generationLimit,
    } = req.body as {
      username?: string;
      email?: string;
      password?: string;
      operatorName?: string;
      districtName?: string;
      wardNo?: string;
      localBodyType?: LocalBodyType;
      localBodyName?: string;
      formerLocalBodyType?: LocalBodyType;
      formerLocalBodyName?: string;
      formerWardNo?: string;
      generationLimit?: number | string | null;
    };

    const normalizedUsername = normalizeWardUsername(username ?? "");
    const normalizedEmail = email?.trim().toLowerCase() || undefined;
    let parsedGenerationLimit: number | null;
    try {
      parsedGenerationLimit = parseGenerationLimit(generationLimit);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Invalid generation limit",
      });
      return;
    }

    if (!normalizedUsername || !isValidWardUsername(normalizedUsername)) {
      res.status(400).json({
        error:
          "Username is required (3–40 characters; letters, numbers, . _ - only)",
      });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({
        error: "Password (min 8 characters) is required",
      });
      return;
    }
    if (
      !operatorName?.trim() ||
      !districtName?.trim() ||
      !wardNo?.trim() ||
      !localBodyName?.trim() ||
      !formerLocalBodyName?.trim() ||
      !formerWardNo?.trim()
    ) {
      res.status(400).json({ error: "All ward operator fields are required" });
      return;
    }
    if (
      localBodyType !== "nagarpalika" &&
      localBodyType !== "gaupalika" &&
      localBodyType !== "mahanagarpalika"
    ) {
      res.status(400).json({ error: "Invalid local body type" });
      return;
    }
    if (
      formerLocalBodyType !== "nagarpalika" &&
      formerLocalBodyType !== "gaupalika" &&
      formerLocalBodyType !== "mahanagarpalika"
    ) {
      res.status(400).json({ error: "Invalid former local body type" });
      return;
    }

    const existingUsername = await WardOperatorProfile.findOne({
      username: normalizedUsername,
    });
    if (existingUsername) {
      res.status(409).json({ error: "This username is already taken" });
      return;
    }

    const storageEmail = wardOperatorStorageEmail(normalizedUsername, normalizedEmail);
    const existing = await User.findOne({ email: storageEmail });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: operatorName.trim(),
      email: storageEmail,
      userType: "wardOperator",
      authProvider: "local",
      passwordHash,
    });

    const profile = await WardOperatorProfile.create({
      userId: user._id,
      username: normalizedUsername,
      operatorName: operatorName.trim(),
      districtName: districtName.trim(),
      wardNo: wardNo.trim(),
      localBodyType,
      localBodyName: localBodyName.trim(),
      formerLocalBodyType,
      formerLocalBodyName: formerLocalBodyName.trim(),
      formerWardNo: formerWardNo.trim(),
      generationLimit: parsedGenerationLimit,
      generationCount: 0,
      active: true,
      createdBy: new mongoose.Types.ObjectId(req.user!.id),
    });

    res.status(201).json(
      wardOperatorProfileToJson(profile, userToJson(user))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create ward operator" });
  }
});

router.patch("/ward-operators/:id", async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const profile = await WardOperatorProfile.findById(id);
    if (!profile) {
      res.status(404).json({ error: "Ward operator not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    if (typeof body.active === "boolean") profile.active = body.active;
    if (typeof body.operatorName === "string" && body.operatorName.trim()) {
      profile.operatorName = body.operatorName.trim();
      const namedUser = await User.findById(profile.userId);
      if (namedUser) {
        namedUser.name = profile.operatorName;
        await namedUser.save();
      }
    }
    if (typeof body.username === "string" && body.username.trim()) {
      const normalizedUsername = normalizeWardUsername(body.username);
      if (!isValidWardUsername(normalizedUsername)) {
        res.status(400).json({
          error:
            "Username must be 3–40 characters; letters, numbers, . _ - only",
        });
        return;
      }
      const taken = await WardOperatorProfile.findOne({
        username: normalizedUsername,
        _id: { $ne: profile._id },
      });
      if (taken) {
        res.status(409).json({ error: "This username is already taken" });
        return;
      }
      profile.username = normalizedUsername;
    }
    if (typeof body.districtName === "string" && body.districtName.trim()) {
      profile.districtName = body.districtName.trim();
    }
    if (typeof body.wardNo === "string" && body.wardNo.trim()) {
      profile.wardNo = body.wardNo.trim();
    }
    if (
      body.localBodyType === "nagarpalika" ||
      body.localBodyType === "gaupalika" ||
      body.localBodyType === "mahanagarpalika"
    ) {
      profile.localBodyType = body.localBodyType;
    }
    if (typeof body.localBodyName === "string" && body.localBodyName.trim()) {
      profile.localBodyName = body.localBodyName.trim();
    }
    if (
      body.formerLocalBodyType === "nagarpalika" ||
      body.formerLocalBodyType === "gaupalika" ||
      body.formerLocalBodyType === "mahanagarpalika"
    ) {
      profile.formerLocalBodyType = body.formerLocalBodyType;
    }
    if (
      typeof body.formerLocalBodyName === "string" &&
      body.formerLocalBodyName.trim()
    ) {
      profile.formerLocalBodyName = body.formerLocalBodyName.trim();
    }
    if (typeof body.formerWardNo === "string" && body.formerWardNo.trim()) {
      profile.formerWardNo = body.formerWardNo.trim();
    }

    if (body.generationLimit !== undefined) {
      try {
        profile.generationLimit = parseGenerationLimit(body.generationLimit);
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "Invalid generation limit",
        });
        return;
      }
    }

    if (body.resetGenerationCount === true) {
      profile.generationCount = 0;
    }

    if (typeof body.password === "string" && body.password.length >= 8) {
      const user = await User.findById(profile.userId);
      if (user) {
        user.passwordHash = await bcrypt.hash(body.password, 10);
        if (profile.operatorName) user.name = profile.operatorName;
        await user.save();
      }
    }

    if (typeof body.email === "string") {
      const user = await User.findById(profile.userId);
      if (user) {
        const normalizedEmail = body.email.trim().toLowerCase();
        const storageEmail = wardOperatorStorageEmail(
          profile.username,
          normalizedEmail || undefined
        );
        const taken = await User.findOne({
          email: storageEmail,
          _id: { $ne: user._id },
        });
        if (taken) {
          res.status(409).json({ error: "An account with this email already exists" });
          return;
        }
        user.email = storageEmail;
        await user.save();
      }
    }

    await profile.save();
    const user = await User.findById(profile.userId);
    res.json(
      wardOperatorProfileToJson(profile, user ? userToJson(user) : null)
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update ward operator" });
  }
});

router.get("/ward-templates", async (_req, res) => {
  try {
    const templates = await WardDocumentTemplate.find().sort({ createdAt: -1 });
    res.json(templates.map(wardDocumentTemplateToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list ward templates" });
  }
});

router.post("/ward-templates", async (req: AuthRequest, res) => {
  try {
    const {
      nameEn,
      nameNe,
      descriptionEn,
      descriptionNe,
      variables,
      status,
      fileName,
      fileData,
    } = req.body as {
      nameEn?: string;
      nameNe?: string;
      descriptionEn?: string;
      descriptionNe?: string;
      variables?: unknown;
      status?: "draft" | "published";
      fileName?: string;
      fileData?: string;
    };

    if (!nameEn?.trim() || !fileName?.trim() || !fileData?.trim()) {
      res.status(400).json({
        error: "Template name, file name, and file data are required",
      });
      return;
    }

    const baseSlug = slugify(nameEn);
    let slug = baseSlug || `template-${Date.now()}`;
    let suffix = 1;
    while (await WardDocumentTemplate.exists({ slug })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const buffer = decodeBase64File(fileData);
    const stored = await storeWardTemplateFile(fileName, buffer);
    const detectedKeys =
      stored.fileType === "docx" ? extractPlaceholdersFromDocx(buffer) : [];

    const template = await WardDocumentTemplate.create({
      slug,
      nameEn: nameEn.trim(),
      nameNe: nameNe?.trim() ?? "",
      descriptionEn: descriptionEn?.trim() ?? "",
      descriptionNe: descriptionNe?.trim() ?? "",
      variables: mergeTemplateVariables(parseVariables(variables), detectedKeys),
      fileType: stored.fileType,
      storageKey: stored.storageKey,
      originalFileName: fileName.trim(),
      status: status === "published" ? "published" : "draft",
      createdBy: new mongoose.Types.ObjectId(req.user!.id),
    });

    res.status(201).json(wardDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to create template",
    });
  }
});

router.get("/ward-templates/:id/file", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await WardDocumentTemplate.findById(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const buffer = await readWardTemplateFileBuffer(template.storageKey);
    const contentType =
      template.fileType === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const fileName =
      template.originalFileName?.trim() ||
      `${template.slug || "template"}.${template.fileType === "pdf" ? "pdf" : "docx"}`;

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load template file",
    });
  }
});

router.put("/ward-templates/:id/content", async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await WardDocumentTemplate.findById(id);
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

    const buffer = await overwriteWardTemplateDocxFromHtml(
      template.storageKey,
      content
    );
    template.variables = refreshTemplateVariablesFromDocx(
      template.variables,
      buffer
    );
    await template.save();

    res.json(wardDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to save template content",
    });
  }
});

router.patch("/ward-templates/:id", async (req: AuthRequest, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await WardDocumentTemplate.findById(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    if (typeof body.nameEn === "string" && body.nameEn.trim()) {
      template.nameEn = body.nameEn.trim();
    }
    if (typeof body.nameNe === "string") template.nameNe = body.nameNe.trim();
    if (typeof body.descriptionEn === "string") {
      template.descriptionEn = body.descriptionEn.trim();
    }
    if (typeof body.descriptionNe === "string") {
      template.descriptionNe = body.descriptionNe.trim();
    }
    if (body.status === "draft" || body.status === "published") {
      template.status = body.status;
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
      const stored = await storeWardTemplateFile(body.fileName as string, buffer);
      await removeWardTemplateFile(template.storageKey);
      template.storageKey = stored.storageKey;
      template.fileType = stored.fileType;
      template.originalFileName = (body.fileName as string).trim();
      if (stored.fileType === "docx") {
        template.variables = refreshTemplateVariablesFromDocx(
          template.variables,
          buffer
        );
      } else {
        template.variables = [];
      }
    }

    await template.save();
    res.json(wardDocumentTemplateToJson(template));
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to update template",
    });
  }
});

router.delete("/ward-templates/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await WardDocumentTemplate.findByIdAndDelete(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    await removeWardTemplateFile(template.storageKey);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
