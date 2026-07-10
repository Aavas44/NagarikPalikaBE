import { Router } from "express";
import { DemoRequest, demoRequestToJson } from "../models/DemoRequest";

const router = Router();

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+()-]{7,30}$/;

router.post("/", async (req, res) => {
  try {
    const { sessionId, name, email, contactNo, profession, queries, locale } = req.body as {
      sessionId?: string;
      name?: string;
      email?: string;
      contactNo?: string;
      profession?: string;
      queries?: string;
      locale?: string;
    };

    if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: "Invalid session" });
      return;
    }

    const trimmedName = name?.trim().slice(0, 120) ?? "";
    const trimmedEmail = email?.trim().toLowerCase() ?? "";
    const trimmedContact = contactNo?.trim() ?? "";
    const trimmedProfession = profession?.trim().slice(0, 200) ?? "";
    const trimmedQueries = queries?.trim() ?? "";

    if (!trimmedName) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }
    if (!trimmedContact || !PHONE_RE.test(trimmedContact)) {
      res.status(400).json({ error: "Valid contact number is required" });
      return;
    }
    if (!trimmedProfession) {
      res.status(400).json({ error: "Profession is required" });
      return;
    }
    if (trimmedQueries.length < 10) {
      res.status(400).json({ error: "Please describe your queries (at least 10 characters)" });
      return;
    }
    if (trimmedQueries.length > 2000) {
      res.status(400).json({ error: "Queries must be at most 2000 characters" });
      return;
    }

    const existing = await DemoRequest.findOne({ sessionId });
    if (existing) {
      res.status(409).json({ error: "Demo request already submitted for this session" });
      return;
    }

    const request = await DemoRequest.create({
      sessionId,
      name: trimmedName,
      email: trimmedEmail,
      contactNo: trimmedContact,
      profession: trimmedProfession,
      queries: trimmedQueries,
      locale: locale === "ne" ? "ne" : "en",
    });

    res.status(201).json(demoRequestToJson(request));
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({ error: "Demo request already submitted for this session" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to submit demo request" });
  }
});

export default router;
