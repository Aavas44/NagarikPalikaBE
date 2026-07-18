import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Team } from "../models/Team";
import {
  SajiloKanunAccount,
  sajiloKanunAccountToJson,
} from "../models/SajiloKanunAccount";
import {
  LegalCase,
  legalCaseToJson,
  type LegalCaseStatus,
  type LegalCaseType,
} from "../models/LegalCase";
import {
  requireSajiloKanunAuth,
  requireSkPermission,
  requireSkTeamMember,
  signSajiloKanunToken,
  type SajiloKanunAuthRequest,
} from "../middleware/sajilokanun-auth";
import {
  createTeamAccount,
  assertTeamActive,
  accountToAuthUser,
} from "../services/team-accounts";
import {
  getSajiloKanunUsageLog,
  getSajiloKanunUsageSummary,
  recordSajiloKanunUsage,
  sanitizeUsageEntries,
  getTeamUsageLog,
  getTeamUsageSummary,
  type UsageRequestMeta,
} from "../services/sajilokanun-usage";
import { hasRolePermission } from "../services/role-policies";
import {
  getIndividualDailyQuota,
  reserveIndividualDailyQuery,
} from "../services/sajilokanun-quota";

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

    if (account.teamId) {
      const teamActive = await assertTeamActive(account.teamId.toString());
      if (!teamActive) {
        res.status(403).json({ error: "Your law firm account is inactive" });
        return;
      }
    }

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const authUser = accountToAuthUser(account);
    const token = signSajiloKanunToken(authUser);

    res.json({
      token,
      user: sajiloKanunAccountToJson(account),
    });
  } catch (err) {
    console.error("Sajilo Kanun login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get(
  "/authorize/chat",
  requireSajiloKanunAuth,
  requireSkPermission("sk.chat.use"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (user.teamId || user.role) {
        res.json({ allowed: true, quota: null });
        return;
      }
      if (req.query.consume !== "1") {
        res.json({
          allowed: true,
          quota: await getIndividualDailyQuota(user.id),
        });
        return;
      }

      const rawQuestionId = req.query.questionId;
      const questionId = Array.isArray(rawQuestionId)
        ? rawQuestionId[0]
        : rawQuestionId;
      const rawQuestionHash = req.query.questionHash;
      const questionHash = Array.isArray(rawQuestionHash)
        ? rawQuestionHash[0]
        : rawQuestionHash;
      const quota = await reserveIndividualDailyQuery(
        user.id,
        typeof questionId === "string" ? questionId : "",
        typeof questionHash === "string" ? questionHash : ""
      );
      if (!quota.allowed) {
        const status =
          quota.reason === "question_identity_required" ? 400 : 429;
        res.status(status).json({
          error:
            status === 429
              ? "Your free query for today has been used. Try again after the daily reset."
              : "A valid question identity is required.",
          quota,
        });
        return;
      }
      res.json({ allowed: true, quota });
    } catch (err) {
      console.error("Sajilo Kanun authorization error:", err);
      res.status(500).json({ error: "Failed to verify query allowance" });
    }
  }
);

router.get(
  "/quota",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (user.teamId || user.role) {
        res.json({ quota: null, plan: "firm" });
        return;
      }
      res.json({
        quota: await getIndividualDailyQuota(user.id),
        plan: "individual",
      });
    } catch (err) {
      console.error("Sajilo Kanun quota error:", err);
      res.status(500).json({ error: "Failed to load query allowance" });
    }
  }
);

router.get("/me", requireSajiloKanunAuth, async (req: SajiloKanunAuthRequest, res) => {
  try {
    const account = await SajiloKanunAccount.findById(req.sajiloKanunUser!.id);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    let teamName: string | null = null;
    if (account.teamId) {
      const team = await Team.findById(account.teamId).select("name");
      teamName = team?.name ?? null;
    }
    res.json({
      user: {
        ...sajiloKanunAccountToJson(account),
        teamName,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

router.get("/usage", requireSajiloKanunAuth, async (req: SajiloKanunAuthRequest, res) => {
  try {
    const user = req.sajiloKanunUser!;
    const roleKey =
      user.role === "admin"
        ? "sk.firm_admin"
        : user.role === "member"
          ? "sk.member"
          : "sk.individual";
    if (
      user.teamId &&
      (await hasRolePermission(roleKey, "sk.usage.read_team"))
    ) {
      const usage = await getTeamUsageSummary(user.teamId);
      res.json({ usage, scope: "team" });
      return;
    }
    if (!(await hasRolePermission(roleKey, "sk.usage.read_self"))) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }
    const usage = await getSajiloKanunUsageSummary(user.id);
    res.json({ usage, scope: "self" });
  } catch (err) {
    console.error("Sajilo Kanun usage fetch error:", err);
    res.status(500).json({ error: "Failed to load token usage" });
  }
});

router.get("/usage/log", requireSajiloKanunAuth, async (req: SajiloKanunAuthRequest, res) => {
  try {
    const limit = Number(req.query.limit ?? 30);
    const offset = Number(req.query.offset ?? 0);
    const user = req.sajiloKanunUser!;

    const roleKey =
      user.role === "admin"
        ? "sk.firm_admin"
        : user.role === "member"
          ? "sk.member"
          : "sk.individual";
    if (
      user.teamId &&
      (await hasRolePermission(roleKey, "sk.usage.read_team"))
    ) {
      const log = await getTeamUsageLog(user.teamId, { limit, offset });
      res.json({ ...log, scope: "team" });
      return;
    }
    if (!(await hasRolePermission(roleKey, "sk.usage.read_self"))) {
      res.status(403).json({ error: "Permission denied" });
      return;
    }

    const log = await getSajiloKanunUsageLog(user.id, { limit, offset });
    res.json({ ...log, scope: "self" });
  } catch (err) {
    console.error("Sajilo Kanun usage log error:", err);
    res.status(500).json({ error: "Failed to load usage log" });
  }
});

router.post("/usage", requireSajiloKanunAuth, async (req: SajiloKanunAuthRequest, res) => {
  try {
    const entries = sanitizeUsageEntries(req.body?.entries);
    const requestId =
      typeof req.body?.requestId === "string" ? req.body.requestId.trim() : "";
    const requestType =
      req.body?.requestType === "normalize" || req.body?.requestType === "chat"
        ? req.body.requestType
        : undefined;
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;

    const request: UsageRequestMeta | undefined =
      requestId && requestType
        ? { requestId, requestType, label }
        : undefined;

    const usage = await recordSajiloKanunUsage(req.sajiloKanunUser!.id, entries, request);
    res.json({ usage, recorded: entries.length });
  } catch (err) {
    console.error("Sajilo Kanun usage record error:", err);
    res.status(500).json({ error: "Failed to record token usage" });
  }
});

// --- Firm admin: team members ---

router.get(
  "/team/members",
  requireSajiloKanunAuth,
  requireSkPermission("sk.members.manage"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const accounts = await SajiloKanunAccount.find({
        teamId: req.sajiloKanunUser!.teamId,
      }).sort({ createdAt: -1 });
      res.json(accounts.map(sajiloKanunAccountToJson));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list members" });
    }
  }
);

router.post(
  "/team/members",
  requireSajiloKanunAuth,
  requireSkPermission("sk.members.manage"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const { username, password, name, email, contactNo } = req.body as {
        username?: string;
        password?: string;
        name?: string;
        email?: string;
        contactNo?: string;
      };

      if (!username?.trim() || !password || !name?.trim()) {
        res.status(400).json({ error: "Username, password, and name are required" });
        return;
      }

      const account = await createTeamAccount({
        teamId: req.sajiloKanunUser!.teamId!,
        username,
        password,
        name,
        email,
        contactNo,
        role: "member",
        createdBy: req.sajiloKanunUser!.id,
      });

      res.status(201).json(sajiloKanunAccountToJson(account));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create member";
      const status = message.includes("already taken") ? 409 : 400;
      console.error(err);
      res.status(status).json({ error: message });
    }
  }
);

router.patch(
  "/team/members/:id",
  requireSajiloKanunAuth,
  requireSkPermission("sk.members.manage"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const account = await SajiloKanunAccount.findOne({
        _id: req.params.id,
        teamId: req.sajiloKanunUser!.teamId,
        role: "member",
      });
      if (!account) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const { active, password } = req.body as { active?: boolean; password?: string };
      if (typeof active === "boolean") account.active = active;
      if (password) account.passwordHash = await bcrypt.hash(password, 10);
      await account.save();

      res.json(sajiloKanunAccountToJson(account));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update member" });
    }
  }
);

router.get(
  "/team/usage",
  requireSajiloKanunAuth,
  requireSkPermission("sk.usage.read_team"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const limit = Number(req.query.limit ?? 30);
      const offset = Number(req.query.offset ?? 0);
      const teamId = req.sajiloKanunUser!.teamId!;
      const summary = await getTeamUsageSummary(teamId);
      const log = await getTeamUsageLog(teamId, { limit, offset });
      res.json({ usage: summary, ...log });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load team usage" });
    }
  }
);

// --- Cases ---

function parseCaseType(value: unknown): LegalCaseType | null {
  if (value === "civil" || value === "criminal" || value === "other") return value;
  return null;
}

function parseCaseStatus(value: unknown): LegalCaseStatus | null {
  if (value === "open" || value === "pending" || value === "closed") return value;
  return null;
}

router.get(
  "/cases",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      const filter: Record<string, unknown> = { teamId: user.teamId };
      const roleKey =
        user.role === "admin"
          ? "sk.firm_admin"
          : user.role === "member"
            ? "sk.member"
            : "sk.individual";
      const canReadAll = await hasRolePermission(roleKey, "sk.cases.read_all");
      const canReadAssigned = await hasRolePermission(
        roleKey,
        "sk.cases.read_assigned"
      );
      if (!canReadAll && !canReadAssigned) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      if (!canReadAll) {
        filter.assignedMemberIds = new mongoose.Types.ObjectId(user.id);
      }

      const cases = await LegalCase.find(filter).sort({ updatedAt: -1 });
      res.json(cases.map(legalCaseToJson));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list cases" });
    }
  }
);

router.post(
  "/cases",
  requireSajiloKanunAuth,
  requireSkPermission("sk.cases.manage"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const { title, caseNo, type, status, notes, assignedMemberIds } = req.body as {
        title?: string;
        caseNo?: string;
        type?: string;
        status?: string;
        notes?: string;
        assignedMemberIds?: string[];
      };

      const caseType = parseCaseType(type);
      if (!title?.trim() || !caseNo?.trim() || !caseType) {
        res.status(400).json({ error: "Title, case number, and type are required" });
        return;
      }

      const caseStatus = parseCaseStatus(status) ?? "open";
      const teamId = req.sajiloKanunUser!.teamId!;

      const memberIds = await validateAssignedMembers(
        teamId,
        assignedMemberIds ?? []
      );

      const legalCase = await LegalCase.create({
        teamId,
        title: title.trim(),
        caseNo: caseNo.trim(),
        type: caseType,
        status: caseStatus,
        notes: notes?.trim(),
        assignedMemberIds: memberIds,
        createdBy: req.sajiloKanunUser!.id,
      });

      res.status(201).json(legalCaseToJson(legalCase));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create case";
      const status = message.includes("duplicate") ? 409 : 400;
      console.error(err);
      res.status(status).json({ error: message });
    }
  }
);

router.patch(
  "/cases/:id",
  requireSajiloKanunAuth,
  requireSkPermission("sk.cases.manage"),
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const legalCase = await LegalCase.findOne({
        _id: req.params.id,
        teamId: req.sajiloKanunUser!.teamId,
      });
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { title, caseNo, type, status, notes, assignedMemberIds } = req.body as {
        title?: string;
        caseNo?: string;
        type?: string;
        status?: string;
        notes?: string;
        assignedMemberIds?: string[];
      };

      if (title?.trim()) legalCase.title = title.trim();
      if (caseNo?.trim()) legalCase.caseNo = caseNo.trim();
      const caseType = parseCaseType(type);
      if (caseType) legalCase.type = caseType;
      const caseStatus = parseCaseStatus(status);
      if (caseStatus) legalCase.status = caseStatus;
      if (notes !== undefined) legalCase.notes = notes.trim();
      if (assignedMemberIds) {
        legalCase.assignedMemberIds = await validateAssignedMembers(
          req.sajiloKanunUser!.teamId!,
          assignedMemberIds
        );
      }

      await legalCase.save();
      res.json(legalCaseToJson(legalCase));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update case";
      const status = message.includes("duplicate") ? 409 : 400;
      console.error(err);
      res.status(status).json({ error: message });
    }
  }
);

async function validateAssignedMembers(
  teamId: string,
  memberIds: string[]
): Promise<mongoose.Types.ObjectId[]> {
  if (memberIds.length === 0) return [];

  const objectIds = memberIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const count = await SajiloKanunAccount.countDocuments({
    _id: { $in: objectIds },
    teamId,
    role: "member",
    active: true,
  });

  if (count !== objectIds.length) {
    throw new Error("One or more assigned members are invalid");
  }

  return objectIds;
}

export default router;
