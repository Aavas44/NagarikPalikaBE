import { Router } from "express";
import bcrypt from "bcryptjs";
import { SajiloKanunAccount, sajiloKanunAccountToJson } from "../models/SajiloKanunAccount";
import {
  requireSajiloKanunAuth,
  signSajiloKanunToken,
  type SajiloKanunAuthRequest,
} from "../middleware/sajilokanun-auth";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const account = await SajiloKanunAccount.findOne({
      username: username.trim().toLowerCase(),
      active: true,
    });

    if (!account) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = signSajiloKanunToken({
      id: account._id.toString(),
      username: account.username,
      name: account.name,
    });

    res.json({
      token,
      user: sajiloKanunAccountToJson(account),
    });
  } catch (err) {
    console.error("Sajilo Kanun login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", requireSajiloKanunAuth, async (req: SajiloKanunAuthRequest, res) => {
  res.json({ user: req.sajiloKanunUser });
});

export default router;
