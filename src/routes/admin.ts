import { Router } from "express";
import { Feedback, feedbackToJson } from "../models/Feedback";
import { AdvocateProfile, advocateToJson } from "../models/AdvocateProfile";
import { ConsultationRequest, consultationToJson } from "../models/ConsultationRequest";
import { ConsultationEventLog, eventLogToJson } from "../models/ConsultationEventLog";
import { Payment } from "../models/Payment";
import { requireAuth, requireUserType, type AuthRequest } from "../middleware/auth";
import { logConsultationEvent } from "../services/consultationEvents";

const router = Router();

router.use(requireAuth, requireUserType("admin"));

router.get("/advocates/pending", async (_req, res) => {
  try {
    const pending = await AdvocateProfile.find({ status: "pending" }).sort({
      createdAt: -1,
    });
    res.json(pending.map((p) => advocateToJson(p, { includeContact: true })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list pending advocates" });
  }
});

router.get("/advocates", async (req, res) => {
  try {
    const { status } = req.query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    const advocates = await AdvocateProfile.find(filter).sort({ createdAt: -1 });
    res.json(advocates.map((a) => advocateToJson(a, { includeContact: true })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list advocates" });
  }
});

router.patch("/advocates/:id/approve", async (req: AuthRequest, res) => {
  try {
    const profile = await AdvocateProfile.findByIdAndUpdate(
      req.params.id,
      {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: req.user!.id,
        rejectionReason: undefined,
      },
      { new: true }
    );
    if (!profile) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(advocateToJson(profile, { includeContact: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve" });
  }
});

router.patch("/advocates/:id/reject", async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    const profile = await AdvocateProfile.findByIdAndUpdate(
      req.params.id,
      { status: "rejected", rejectionReason: reason },
      { new: true }
    );
    if (!profile) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(advocateToJson(profile, { includeContact: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject" });
  }
});

router.get("/consultations", async (req, res) => {
  try {
    const { status } = req.query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const requests = await ConsultationRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(200);

    const results = await Promise.all(
      requests.map(async (r) => {
        const payment = r.paymentId ? await Payment.findById(r.paymentId) : null;
        let acceptedAdvocate;
        if (r.acceptedByAdvocateId) {
          const adv = await AdvocateProfile.findById(r.acceptedByAdvocateId);
          acceptedAdvocate = adv
            ? { name: adv.advocateName, firm: adv.firmName }
            : undefined;
        }
        return {
          ...consultationToJson(r, { includeUserContact: true }),
          paymentStatus: payment?.status ?? "none",
          acceptedAdvocate,
        };
      })
    );

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list consultations" });
  }
});

router.get("/consultations/:id/events", async (req, res) => {
  try {
    const events = await ConsultationEventLog.find({ requestId: req.params.id }).sort({
      createdAt: 1,
    });
    res.json(events.map(eventLogToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

router.post("/consultations/:id/complete", async (req: AuthRequest, res) => {
  try {
    const request = await ConsultationRequest.findByIdAndUpdate(
      req.params.id,
      { status: "completed" },
      { new: true }
    );
    if (!request) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logConsultationEvent(request._id, "completed", "admin", req.user!.id);
    res.json(consultationToJson(request));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to complete" });
  }
});

router.get("/feedback", async (req, res) => {
  try {
    const { status } = req.query;
    const filter: Record<string, unknown> = {};
    if (status === "new" || status === "reviewed") {
      filter.status = status;
    }

    const items = await Feedback.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(items.map(feedbackToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list feedback" });
  }
});

router.patch("/feedback/:id/review", async (req: AuthRequest, res) => {
  try {
    const feedback = await Feedback.findByIdAndUpdate(
      req.params.id,
      {
        status: "reviewed",
        reviewedAt: new Date(),
        reviewedBy: req.user!.id,
      },
      { new: true }
    );
    if (!feedback) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(feedbackToJson(feedback));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update feedback" });
  }
});

export default router;
