import { Router } from "express";
import {
  initPayment,
  verifyEsewaPayment,
  verifyKhaltiPayment,
  devMarkPaymentPaid,
} from "../services/payments";
import { requireAuth, requireUserType, type AuthRequest } from "../middleware/auth";

const router = Router();

router.post(
  "/consultations/:id/pay/esewa",
  requireAuth,
  requireUserType("user"),
  async (req: AuthRequest, res) => {
    try {
      const result = await initPayment(String(req.params.id), req.user!.id, "esewa");
      res.json({
        paymentId: result.payment._id.toString(),
        redirectUrl: result.redirectUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment init failed";
      res.status(400).json({ error: message });
    }
  }
);

router.post(
  "/consultations/:id/pay/khalti",
  requireAuth,
  requireUserType("user"),
  async (req: AuthRequest, res) => {
    try {
      const result = await initPayment(String(req.params.id), req.user!.id, "khalti");
      res.json({
        paymentId: result.payment._id.toString(),
        khalti: result.khalti,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment init failed";
      res.status(400).json({ error: message });
    }
  }
);

router.get("/esewa/verify", async (req, res) => {
  try {
    const { paymentId, refId, amt } = req.query;
    if (!paymentId || !refId || !amt) {
      res.status(400).json({ error: "Missing verification parameters" });
      return;
    }
    const payment = await verifyEsewaPayment(
      String(paymentId),
      String(refId),
      String(amt)
    );
    res.json({ ok: true, paymentId: payment._id.toString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    res.status(400).json({ error: message });
  }
});

router.post("/khalti/verify", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { paymentId, token } = req.body as { paymentId?: string; token?: string };
    if (!paymentId || !token) {
      res.status(400).json({ error: "paymentId and token required" });
      return;
    }
    const payment = await verifyKhaltiPayment(paymentId, token);
    res.json({ ok: true, paymentId: payment._id.toString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    res.status(400).json({ error: message });
  }
});

router.post(
  "/dev/mark-paid/:paymentId",
  requireAuth,
  requireUserType("user"),
  async (req: AuthRequest, res) => {
    try {
      const payment = await devMarkPaymentPaid(String(req.params.paymentId));
      res.json({ ok: true, paymentId: payment._id.toString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      res.status(400).json({ error: message });
    }
  }
);

export default router;
