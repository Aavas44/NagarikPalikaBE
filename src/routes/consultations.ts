import { Router } from "express";
import mongoose from "mongoose";
import { AdvocateProfile } from "../models/AdvocateProfile";
import { ConsultationInvite } from "../models/ConsultationInvite";
import {
  ConsultationRequest,
  consultationToJson,
} from "../models/ConsultationRequest";
import { requireAuth, requireUserType, type AuthRequest } from "../middleware/auth";
import { logConsultationEvent } from "../services/consultationEvents";
import { CONSULT_FEE_NPR, CONSULT_DURATION_MINUTES } from "../types";

const router = Router();

router.post("/", requireAuth, requireUserType("user"), async (req: AuthRequest, res) => {
  try {
    const {
      name,
      specialty,
      contactNo,
      province,
      district,
      particulars,
      whatsapp,
      viber,
      selectedAdvocateIds = [],
    } = req.body;

    if (!name || !specialty || !contactNo || !province || !district || !particulars) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    if (!whatsapp && !viber) {
      res.status(400).json({ error: "WhatsApp or Viber is required" });
      return;
    }

    const advocateIds = (selectedAdvocateIds as string[])
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const request = await ConsultationRequest.create({
      userId: req.user!.id,
      name,
      specialty,
      contactNo,
      province,
      district,
      particulars,
      whatsapp,
      viber,
      selectedAdvocateIds: advocateIds,
      feeNpr: CONSULT_FEE_NPR,
      durationMinutes: CONSULT_DURATION_MINUTES,
      status: "payment_pending",
    });

    await logConsultationEvent(request._id, "request_created", "user", req.user!.id);

    res.status(201).json(consultationToJson(request));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create consultation" });
  }
});

router.get("/mine", requireAuth, requireUserType("user"), async (req: AuthRequest, res) => {
  try {
    const requests = await ConsultationRequest.find({ userId: req.user!.id }).sort({
      createdAt: -1,
    });

    const results = await Promise.all(
      requests.map(async (r) => {
        let advocateContact;
        if (r.status === "accepted" && r.acceptedByAdvocateId) {
          const adv = await AdvocateProfile.findById(r.acceptedByAdvocateId);
          if (adv) {
            advocateContact = {
              mobile: adv.mobile,
              whatsapp: adv.whatsapp,
              viber: adv.viber,
              advocateName: adv.advocateName,
              firmName: adv.firmName,
            };
          }
        }
        return consultationToJson(r, {
          includeUserContact: true,
          includeAdvocateContact: r.status === "accepted",
          advocateContact,
        });
      })
    );

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list consultations" });
  }
});

router.get("/incoming", requireAuth, requireUserType("advocate"), async (req: AuthRequest, res) => {
  try {
    const profile = await AdvocateProfile.findOne({
      userId: req.user!.id,
      status: "approved",
    });
    if (!profile) {
      res.json([]);
      return;
    }

    const invites = await ConsultationInvite.find({
      advocateId: profile._id,
      status: "notified",
    }).sort({ notifiedAt: -1 });

    const requestIds = invites.map((i) => i.requestId);
    const requests = await ConsultationRequest.find({
      _id: { $in: requestIds },
      status: { $in: ["pending_selected", "open_pool"] },
    });

    const requestMap = new Map(requests.map((r) => [r._id.toString(), r]));

    const results = invites
      .map((invite) => {
        const request = requestMap.get(invite.requestId.toString());
        if (!request) return null;
        return {
          inviteId: invite._id.toString(),
          tier: invite.tier,
          ...consultationToJson(request),
        };
      })
      .filter(Boolean);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list incoming requests" });
  }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const request = await ConsultationRequest.findById(req.params.id);
    if (!request) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const profile = await AdvocateProfile.findOne({ userId: req.user!.id });
    const isOwner = request.userId.toString() === req.user!.id;
    const isAcceptedAdvocate =
      profile &&
      request.acceptedByAdvocateId?.toString() === profile._id.toString();
    const isAdmin = req.user!.userType === "admin";

    if (!isOwner && !isAcceptedAdvocate && !isAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    let advocateContact;
    if (request.acceptedByAdvocateId) {
      const adv = await AdvocateProfile.findById(request.acceptedByAdvocateId);
      if (adv && (isOwner || isAcceptedAdvocate || isAdmin)) {
        advocateContact = {
          mobile: adv.mobile,
          whatsapp: adv.whatsapp,
          viber: adv.viber,
          advocateName: adv.advocateName,
          firmName: adv.firmName,
        };
      }
    }

    const includeUserContact = Boolean(isAcceptedAdvocate) || isAdmin;
    const includeAdvocateForUser = isOwner && request.status === "accepted";

    res.json(
      consultationToJson(request, {
        includeUserContact,
        includeAdvocateContact: includeAdvocateForUser || Boolean(isAcceptedAdvocate),
        advocateContact,
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch consultation" });
  }
});

router.post("/:id/accept", requireAuth, requireUserType("advocate"), async (req: AuthRequest, res) => {
  try {
    const profile = await AdvocateProfile.findOne({
      userId: req.user!.id,
      status: "approved",
    });
    if (!profile) {
      res.status(403).json({ error: "Advocate profile not approved" });
      return;
    }

    const invite = await ConsultationInvite.findOne({
      requestId: req.params.id,
      advocateId: profile._id,
      status: "notified",
    });
    if (!invite) {
      res.status(404).json({ error: "No pending invite for this request" });
      return;
    }

    const updated = await ConsultationRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $in: ["pending_selected", "open_pool"] },
        acceptedByAdvocateId: { $exists: false },
      },
      {
        $set: {
          status: "accepted",
          acceptedByAdvocateId: profile._id,
          acceptedAt: new Date(),
          contactRevealedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!updated) {
      res.status(409).json({ error: "Request already accepted by another advocate" });
      return;
    }

    invite.status = "accepted";
    invite.respondedAt = new Date();
    await invite.save();

    await ConsultationInvite.updateMany(
      {
        requestId: updated._id,
        _id: { $ne: invite._id },
        status: "notified",
      },
      { status: "expired", respondedAt: new Date() }
    );

    await logConsultationEvent(updated._id, "advocate_accepted", "advocate", profile._id, {
      advocateName: profile.advocateName,
    });
    await logConsultationEvent(updated._id, "contact_revealed", "system", undefined, {
      advocateId: profile._id.toString(),
    });

    const request = await ConsultationRequest.findById(updated._id);
    res.json(
      consultationToJson(request!, {
        includeUserContact: true,
        includeAdvocateContact: true,
        advocateContact: {
          mobile: profile.mobile,
          whatsapp: profile.whatsapp,
          viber: profile.viber,
        },
      })
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to accept consultation" });
  }
});

router.post("/:id/decline", requireAuth, requireUserType("advocate"), async (req: AuthRequest, res) => {
  try {
    const profile = await AdvocateProfile.findOne({ userId: req.user!.id });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const invite = await ConsultationInvite.findOneAndUpdate(
      {
        requestId: req.params.id,
        advocateId: profile._id,
        status: "notified",
      },
      { status: "declined", respondedAt: new Date() },
      { new: true }
    );

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    await logConsultationEvent(String(req.params.id), "advocate_declined", "advocate", profile._id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to decline" });
  }
});

export default router;
