import { Router } from "express";
import { Feedback, feedbackToJson } from "../models/Feedback";

const router = Router();

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/", async (req, res) => {
  try {
    const { sessionId, message, name, email, locale } = req.body as {
      sessionId?: string;
      message?: string;
      name?: string;
      email?: string;
      locale?: string;
    };

    if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
      res.status(400).json({ error: "Invalid session" });
      return;
    }

    const trimmedMessage = message?.trim() ?? "";
    if (trimmedMessage.length < 10) {
      res.status(400).json({ error: "Message must be at least 10 characters" });
      return;
    }
    if (trimmedMessage.length > 2000) {
      res.status(400).json({ error: "Message must be at most 2000 characters" });
      return;
    }

    const trimmedEmail = email?.trim() ?? "";
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }

    const trimmedName = name?.trim().slice(0, 120) ?? "";

    const existing = await Feedback.findOne({ sessionId });
    if (existing) {
      res.status(409).json({ error: "Feedback already submitted for this session" });
      return;
    }

    const feedback = await Feedback.create({
      sessionId,
      name: trimmedName || undefined,
      email: trimmedEmail || undefined,
      message: trimmedMessage,
      locale: locale === "ne" ? "ne" : "en",
    });

    res.status(201).json(feedbackToJson(feedback));
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({ error: "Feedback already submitted for this session" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

export default router;
