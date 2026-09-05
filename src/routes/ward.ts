import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  requireAuth,
  requireWardOperator,
  signToken,
  type AuthRequest,
} from "../middleware/auth";
import { User, userToJson } from "../models/User";
import {
  WardOperatorProfile,
  wardOperatorProfileToJson,
} from "../models/WardOperatorProfile";
import {
  WardDocumentTemplate,
  wardDocumentTemplateToJson,
} from "../models/WardDocumentTemplate";
import { generateWardDocument, getTemplateFormFields } from "../services/ward-document-generation";
import { htmlContentToDocxBuffer } from "../services/ward-template-content";
import { findWardOperatorForLogin } from "../services/ward-operator-auth";
import {
  releaseWardGeneration,
  reserveWardGeneration,
  WardGenerationQuotaError,
} from "../services/ward-operator-quota";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };
    const identifier = (username ?? email ?? "").trim();
    if (!identifier || !password) {
      res.status(400).json({ error: "Username or email and password are required" });
      return;
    }

    const match = await findWardOperatorForLogin(identifier);
    if (!match?.user.passwordHash) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const { user, profile } = match;
    if (!user.passwordHash) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    if (!profile.active) {
      res.status(403).json({ error: "This ward operator account is inactive" });
      return;
    }

    const token = signToken({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      userType: user.userType,
    });

    res.json({
      token,
      user: userToJson(user),
      profile: wardOperatorProfileToJson(profile, userToJson(user)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireAuth, requireWardOperator, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const profile = await WardOperatorProfile.findOne({ userId: user._id });
    if (!profile) {
      res.status(404).json({ error: "Ward operator profile not found" });
      return;
    }
    res.json({
      user: userToJson(user),
      profile: wardOperatorProfileToJson(profile, userToJson(user)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

router.get("/templates/:id/fields", requireAuth, requireWardOperator, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await WardDocumentTemplate.findOne({
      _id: id,
      status: "published",
    });
    if (!template) {
      res.status(404).json({ error: "Published template not found" });
      return;
    }
    res.json(await getTemplateFormFields(template));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load template fields" });
  }
});

router.get("/templates", requireAuth, requireWardOperator, async (_req, res) => {
  try {
    const templates = await WardDocumentTemplate.find({ status: "published" }).sort({
      nameEn: 1,
    });
    res.json(templates.map(wardDocumentTemplateToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

router.put(
  "/starred-templates/:templateId",
  requireAuth,
  requireWardOperator,
  async (req: AuthRequest, res) => {
    try {
      const templateId = Array.isArray(req.params.templateId)
        ? req.params.templateId[0]
        : req.params.templateId;
      if (!templateId || !mongoose.Types.ObjectId.isValid(templateId)) {
        res.status(400).json({ error: "Invalid template id" });
        return;
      }
      const starred = (req.body as { starred?: boolean }).starred;
      if (typeof starred !== "boolean") {
        res.status(400).json({ error: "starred boolean is required" });
        return;
      }

      const template = await WardDocumentTemplate.findOne({
        _id: templateId,
        status: "published",
      });
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const profile = await WardOperatorProfile.findOne({
        userId: req.user!.id,
        active: true,
      });
      if (!profile) {
        res.status(403).json({ error: "Ward operator profile not found or inactive" });
        return;
      }

      const oid = new mongoose.Types.ObjectId(templateId);
      await WardOperatorProfile.updateOne(
        { _id: profile._id },
        starred
          ? { $addToSet: { starredTemplateIds: oid } }
          : { $pull: { starredTemplateIds: oid } }
      );

      const updated = await WardOperatorProfile.findById(profile._id);
      res.json({
        starredTemplateIds: (updated?.starredTemplateIds ?? []).map((id) =>
          id.toString()
        ),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update starred template" });
    }
  }
);

router.post("/documents/preview", requireAuth, requireWardOperator, async (req: AuthRequest, res) => {
  try {
    const { templateId, variables } = req.body as {
      templateId?: string;
      variables?: Record<string, string | number>;
    };

    if (!templateId?.trim()) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }

    const profile = await WardOperatorProfile.findOne({
      userId: req.user!.id,
      active: true,
    });
    if (!profile) {
      res.status(403).json({ error: "Ward operator profile not found or inactive" });
      return;
    }

    const template = await WardDocumentTemplate.findOne({
      _id: templateId,
      status: "published",
    });
    if (!template) {
      res.status(404).json({ error: "Published template not found" });
      return;
    }

    const result = await generateWardDocument(
      template,
      profile,
      variables ?? {},
      { validateRequired: false, forPreview: true }
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(result.fileName)}"`
    );
    res.send(result.buffer);
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to preview document",
    });
  }
});

router.post("/documents/generate", requireAuth, requireWardOperator, async (req: AuthRequest, res) => {
  try {
    const { templateId, variables, allowIncomplete } = req.body as {
      templateId?: string;
      variables?: Record<string, string | number>;
      allowIncomplete?: boolean;
    };

    if (!templateId?.trim()) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }

    const user = await User.findById(req.user!.id);
    const profile = await WardOperatorProfile.findOne({
      userId: req.user!.id,
      active: true,
    });
    if (!user || !profile) {
      res.status(403).json({ error: "Ward operator profile not found or inactive" });
      return;
    }

    const template = await WardDocumentTemplate.findOne({
      _id: templateId,
      status: "published",
    });
    if (!template) {
      res.status(404).json({ error: "Published template not found" });
      return;
    }

    const profileId = profile._id.toString();
    let reserved = false;
    try {
      await reserveWardGeneration(profileId);
      reserved = true;

      const result = await generateWardDocument(
        template,
        profile,
        variables ?? {},
        { validateRequired: allowIncomplete !== true }
      );

      res.setHeader("Content-Type", result.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(result.fileName)}"`
      );
      res.send(result.buffer);
    } catch (err) {
      if (reserved) {
        await releaseWardGeneration(profileId);
      }
      if (err instanceof WardGenerationQuotaError) {
        res.status(err.code === "quota_exceeded" ? 429 : 403).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to generate document",
    });
  }
});

/** Convert edited preview HTML to a downloadable DOCX (no quota charge). */
router.post("/documents/from-html", requireAuth, requireWardOperator, async (req: AuthRequest, res) => {
  try {
    const { html, fileName } = req.body as {
      html?: string;
      fileName?: string;
    };
    if (!html?.trim()) {
      res.status(400).json({ error: "html is required" });
      return;
    }

    const profile = await WardOperatorProfile.findOne({
      userId: req.user!.id,
      active: true,
    });
    if (!profile) {
      res.status(403).json({ error: "Ward operator profile not found or inactive" });
      return;
    }

    const buffer = await htmlContentToDocxBuffer(html);
    const safeName = (fileName?.trim() || "document.docx").replace(/[^\w.\u0900-\u097F-]+/g, "_");
    const downloadName = safeName.toLowerCase().endsWith(".docx")
      ? safeName
      : `${safeName}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(downloadName)}"`
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to convert HTML to document",
    });
  }
});

export default router;
