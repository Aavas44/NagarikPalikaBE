import { Router } from "express";
import { AdvocateProfile, advocateToJson } from "../models/AdvocateProfile";
import { requireAuth, requireUserType, type AuthRequest } from "../middleware/auth";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { specialty, province, district } = req.query;
    const filter: Record<string, unknown> = { status: "approved" };

    if (specialty && typeof specialty === "string") filter.specialties = specialty;
    if (province && typeof province === "string") filter.provinces = province;
    if (district && typeof district === "string") filter.districts = district;

    const advocates = await AdvocateProfile.find(filter).sort({ advocateName: 1 });
    res.json(advocates.map((a) => advocateToJson(a)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list advocates" });
  }
});

router.get("/profile", requireAuth, requireUserType("advocate"), async (req: AuthRequest, res) => {
  try {
    const profile = await AdvocateProfile.findOne({ userId: req.user!.id });
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(advocateToJson(profile, { includeContact: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

router.post("/profile", requireAuth, requireUserType("advocate"), async (req: AuthRequest, res) => {
  try {
    const {
      firmName,
      advocateName,
      specialties,
      provinces,
      districts,
      mobile,
      whatsapp,
      viber,
      bio,
    } = req.body;

    if (!firmName || !advocateName || !specialties?.length || !provinces?.length || !districts?.length || !mobile) {
      res.status(400).json({ error: "Missing required profile fields" });
      return;
    }
    if (!whatsapp && !viber) {
      res.status(400).json({ error: "WhatsApp or Viber is required" });
      return;
    }

    const existing = await AdvocateProfile.findOne({ userId: req.user!.id });
    if (existing && existing.status === "approved") {
      Object.assign(existing, {
        firmName,
        advocateName,
        specialties,
        provinces,
        districts,
        mobile,
        whatsapp,
        viber,
        bio,
      });
      await existing.save();
      res.json(advocateToJson(existing, { includeContact: true }));
      return;
    }

    if (!existing) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const profile = await AdvocateProfile.findOneAndUpdate(
      { userId: req.user!.id },
      {
        userId: req.user!.id,
        firmName,
        advocateName,
        specialties,
        provinces,
        districts,
        mobile,
        whatsapp,
        viber,
        bio,
        status: "pending",
      },
      { upsert: false, new: true }
    );

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    res.status(200).json(advocateToJson(profile, { includeContact: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

export default router;
