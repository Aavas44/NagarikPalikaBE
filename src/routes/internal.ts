import { Router } from "express";
import { processExpiredSelectedWindows } from "../services/consultationMatching";

const router = Router();
const CRON_SECRET = process.env.CRON_SECRET ?? "dev-cron-secret";

router.post("/consultations/open-pool", async (req, res) => {
  const auth = req.headers["x-cron-secret"];
  if (auth !== CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const count = await processExpiredSelectedWindows();
    res.json({ processed: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cron failed" });
  }
});

export default router;
