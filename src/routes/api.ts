import { Router } from "express";
import { Term, termToJson } from "../models/Term";
import { Template, templateToJson } from "../models/Template";
import { CategoryCard, categoryToJson } from "../models/CategoryCard";
import { QuickTag } from "../models/QuickTag";
import { requireAuth, requireUserType } from "../middleware/auth";
import type { Category, Status } from "../types";

const router = Router();

router.get("/stats", async (_req, res) => {
  const [termsCount, templatesCount, templateDownloads] = await Promise.all([
    Term.countDocuments(),
    Template.countDocuments(),
    Template.aggregate([{ $group: { _id: null, total: { $sum: "$downloads" } } }]),
  ]);

  res.json({
    termsCount,
    templatesCount,
    departmentsCount: 25,
    monthlySearches: 6200,
    templateDownloads: templateDownloads[0]?.total ?? 0,
  });
});

router.get("/terms", async (req, res) => {
  const { category, status, search } = req.query;
  const filter: Record<string, unknown> = {};

  if (category && typeof category === "string") filter.category = category;
  if (status && typeof status === "string") filter.status = status;
  if (search && typeof search === "string") {
    const q = search;
    filter.$or = [
      { "name.en": { $regex: q, $options: "i" } },
      { "name.ne": { $regex: q, $options: "i" } },
      { "definition.en": { $regex: q, $options: "i" } },
      { "definition.ne": { $regex: q, $options: "i" } },
    ];
  }

  const docs = await Term.find(filter).sort({ updatedAt: -1 });
  res.json(docs.map(termToJson));
});

router.get("/terms/:id", async (req, res) => {
  const term = await Term.findOne({ slug: req.params.id });
  if (!term) {
    res.status(404).json({ error: "Term not found" });
    return;
  }
  res.json(termToJson(term));
});

router.post("/terms", requireAuth, requireUserType("admin"), async (req, res) => {
  const { name, category, definition, status } = req.body as {
    name?: { en: string; ne?: string };
    category?: Category;
    definition?: { en: string; ne?: string };
    status?: Status;
  };

  if (!name?.en || !name?.ne || !category || !definition?.en || !definition?.ne) {
    res.status(400).json({
      error: "name.en, name.ne, category, definition.en, and definition.ne are required",
    });
    return;
  }

  const slug = name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const existing = await Term.findOne({ slug });
  if (existing) {
    res.status(409).json({ error: "A term with this name already exists" });
    return;
  }

  const term = await Term.create({
    slug,
    name: { en: name.en, ne: name.ne },
    category,
    definition: { en: definition.en, ne: definition.ne },
    status: status ?? "draft",
  });

  res.status(201).json(termToJson(term));
});

router.get("/templates", async (req, res) => {
  const { category, status, search, fileType } = req.query;
  const filter: Record<string, unknown> = {};

  if (category && typeof category === "string") filter.category = category;
  if (status && typeof status === "string") filter.status = status;
  if (fileType && typeof fileType === "string") filter.fileType = fileType;
  if (search && typeof search === "string") {
    const q = search;
    filter.$or = [
      { "name.en": { $regex: q, $options: "i" } },
      { "name.ne": { $regex: q, $options: "i" } },
      { fileName: { $regex: q, $options: "i" } },
    ];
  }

  const docs = await Template.find(filter).sort({ updatedAt: -1 });
  res.json(docs.map(templateToJson));
});

router.post("/templates", requireAuth, requireUserType("admin"), async (req, res) => {
  const { name, description, category, fileName, fileType, status } = req.body as {
    name?: { en: string; ne: string };
    description?: { en: string; ne: string };
    category?: Category;
    fileName?: string;
    fileType?: "docx" | "pdf";
    status?: Status;
  };

  if (
    !name?.en ||
    !name?.ne ||
    !description?.en ||
    !description?.ne ||
    !category ||
    !fileName ||
    !fileType
  ) {
    res.status(400).json({
      error:
        "name.en, name.ne, description.en, description.ne, category, fileName, and fileType are required",
    });
    return;
  }

  const slug = name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const existing = await Template.findOne({ slug });
  if (existing) {
    res.status(409).json({ error: "A template with this name already exists" });
    return;
  }

  const gradients = [
    "linear-gradient(160deg,#E6F1FB,#B5D4F4)",
    "linear-gradient(160deg,#EAF3DE,#C0DD97)",
    "linear-gradient(160deg,#FAEEDA,#FAC775)",
    "linear-gradient(160deg,#E1F5EE,#9FE1CB)",
  ];
  const emojis = ["📄", "📋", "📝", "🏛️"];

  const tmpl = await Template.create({
    slug,
    name: { en: name.en, ne: name.ne },
    description: { en: description.en, ne: description.ne },
    category,
    fileName,
    fileType,
    downloads: 0,
    status: status ?? "draft",
    previewEmoji: emojis[Math.floor(Math.random() * emojis.length)],
    previewGradient: gradients[Math.floor(Math.random() * gradients.length)],
  });

  res.status(201).json(templateToJson(tmpl));
});

router.get("/categories", async (_req, res) => {
  const docs = await CategoryCard.find().sort({ sortOrder: 1 });
  res.json(docs.map(categoryToJson));
});

router.get("/quick-tags", async (_req, res) => {
  const docs = await QuickTag.find().sort({ sortOrder: 1 });
  res.json(docs.map((t) => ({ en: t.en, ne: t.ne })));
});

export default router;
