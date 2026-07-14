import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Team, teamToJson } from "../models/Team";
import { SajiloKanunAccount, sajiloKanunAccountToJson } from "../models/SajiloKanunAccount";
import { requireAuth, requireSuperadmin, type AuthRequest } from "../middleware/auth";
import { createTeamAccount } from "../services/team-accounts";
import { getTeamUsageLog, getTeamUsageSummary } from "../services/sajilokanun-usage";
import type { SajiloKanunAccountRole } from "../types";

const router = Router();

router.use(requireAuth, requireSuperadmin);

router.get("/teams", async (_req, res) => {
  try {
    const teams = await Team.find().sort({ createdAt: -1 });
    const teamsWithCounts = await Promise.all(
      teams.map(async (team) => {
        const memberCount = await SajiloKanunAccount.countDocuments({ teamId: team._id });
        return { ...teamToJson(team), memberCount };
      })
    );
    res.json(teamsWithCounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list teams" });
  }
});

router.post("/teams", async (req: AuthRequest, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "Team name is required" });
      return;
    }

    const team = await Team.create({
      name: name.trim(),
      active: true,
      createdBy: req.user!.id,
    });
    res.status(201).json(teamToJson(team));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create team" });
  }
});

router.patch("/teams/:id", async (req, res) => {
  try {
    const { name, active } = req.body as { name?: string; active?: boolean };
    const updates: Record<string, unknown> = {};
    if (name?.trim()) updates.name = name.trim();
    if (typeof active === "boolean") updates.active = active;

    const team = await Team.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }
    res.json(teamToJson(team));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update team" });
  }
});

router.get("/teams/:id/accounts", async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      res.status(404).json({ error: "Team not found" });
      return;
    }

    const accounts = await SajiloKanunAccount.find({ teamId: team._id }).sort({
      createdAt: -1,
    });
    res.json(accounts.map(sajiloKanunAccountToJson));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list accounts" });
  }
});

router.post("/teams/:id/accounts", async (req: AuthRequest, res) => {
  try {
    const { username, password, name, email, role } = req.body as {
      username?: string;
      password?: string;
      name?: string;
      email?: string;
      role?: SajiloKanunAccountRole;
    };

    if (!username?.trim() || !password || !name?.trim()) {
      res.status(400).json({ error: "Username, password, and name are required" });
      return;
    }

    if (role !== "admin" && role !== "member") {
      res.status(400).json({ error: "Role must be admin or member" });
      return;
    }

    const teamId = String(req.params.id);
    const account = await createTeamAccount({
      teamId,
      username,
      password,
      name,
      email,
      role,
      createdBy: req.user!.id,
    });

    res.status(201).json(sajiloKanunAccountToJson(account));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    const status = message.includes("already taken") ? 409 : 400;
    console.error(err);
    res.status(status).json({ error: message });
  }
});

router.patch("/accounts/:id", async (req, res) => {
  try {
    const { active, role, password } = req.body as {
      active?: boolean;
      role?: SajiloKanunAccountRole;
      password?: string;
    };

    const updates: Record<string, unknown> = {};
    if (typeof active === "boolean") updates.active = active;
    if (role === "admin" || role === "member") updates.role = role;
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);

    const account = await SajiloKanunAccount.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json(sajiloKanunAccountToJson(account));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update account" });
  }
});

router.get("/teams/:id/usage", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "Invalid team id" });
      return;
    }

    const limit = Number(req.query.limit ?? 30);
    const offset = Number(req.query.offset ?? 0);
    const summary = await getTeamUsageSummary(req.params.id);
    const log = await getTeamUsageLog(req.params.id, { limit, offset });
    res.json({ usage: summary, ...log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load team usage" });
  }
});

export default router;
