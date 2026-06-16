import { Router } from "express";
import { Lawyer, lawyerToJson } from "../models/Lawyer";
import { requireAuth, requireUserType } from "../middleware/auth";
import type { Status } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  const { status, search } = req.query;
  const filter: Record<string, unknown> = {};

  if (status && typeof status === "string") filter.status = status;
  if (search && typeof search === "string") {
    const q = search;
    filter.$or = [
      { "firmName.en": { $regex: q, $options: "i" } },
      { "lawyerName.en": { $regex: q, $options: "i" } },
      { "officeLocation.en": { $regex: q, $options: "i" } },
      { "firmName.ne": { $regex: q, $options: "i" } },
      { "lawyerName.ne": { $regex: q, $options: "i" } },
      { "officeLocation.ne": { $regex: q, $options: "i" } },
    ];
  }

  const docs = await Lawyer.find(filter).sort({ rating: -1, updatedAt: -1 });
  res.json(docs.map(lawyerToJson));
});

router.post("/", requireAuth, requireUserType("admin"), async (req, res) => {
  const { firmName, lawyerName, officeLocation, rating, ratingCount, status } =
    req.body as {
      firmName?: { en: string; ne?: string };
      lawyerName?: { en: string; ne?: string };
      officeLocation?: { en: string; ne?: string };
      rating?: number;
      ratingCount?: number;
      status?: Status;
    };

  if (
    !firmName?.en ||
    !firmName?.ne ||
    !lawyerName?.en ||
    !lawyerName?.ne ||
    !officeLocation?.en ||
    !officeLocation?.ne ||
    rating == null
  ) {
    res.status(400).json({
      error:
        "firmName, lawyerName, and officeLocation (both en and ne) and rating are required",
    });
    return;
  }

  if (rating < 0 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 0 and 5" });
    return;
  }

  const slug = `${lawyerName.en}-${firmName.en}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const existing = await Lawyer.findOne({ slug });
  if (existing) {
    res.status(409).json({ error: "A lawyer with this name already exists" });
    return;
  }

  const lawyer = await Lawyer.create({
    slug,
    firmName: { en: firmName.en, ne: firmName.ne },
    lawyerName: { en: lawyerName.en, ne: lawyerName.ne },
    officeLocation: { en: officeLocation.en, ne: officeLocation.ne },
    rating,
    ratingCount: ratingCount ?? 0,
    status: status ?? "published",
  });

  res.status(201).json(lawyerToJson(lawyer));
});

router.delete("/:id", requireAuth, requireUserType("admin"), async (req, res) => {
  const lawyer = await Lawyer.findOneAndDelete({ slug: req.params.id });
  if (!lawyer) {
    res.status(404).json({ error: "Lawyer not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
