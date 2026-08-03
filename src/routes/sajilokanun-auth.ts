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
  LEGAL_CASE_DOCUMENT_TITLES,
  legalCaseToJson,
  type LegalCaseDocumentKind,
  type LegalCaseParty,
  type LegalCaseStatus,
  type LegalCaseType,
} from "../models/LegalCase";
import {
  CaseParticipant,
  caseParticipantToJson,
} from "../models/CaseParticipant";
import { CaseMessage, caseMessageToJson } from "../models/CaseMessage";
import {
  CaseUploadedDocument,
  caseUploadedDocumentToJson,
} from "../models/CaseUploadedDocument";
import {
  CaseActivity,
  CASE_ACTIVITY_TYPES,
  caseActivityToJson,
  type CaseActivityType,
} from "../models/CaseActivity";
import {
  createCaseClientAccount,
  isActiveCaseParticipant,
  listActiveCaseIdsForAccount,
} from "../services/case-participants";
import {
  countUnreadClientMessages,
  listUnreadClientThreadsForAccount,
  markCaseMessagesRead,
} from "../services/case-chat-read";
import {
  deleteCaseUploadFile,
  getCaseUploadAcceptAttribute,
  getCaseUploadEditableKind,
  getCaseUploadMaxBytes,
  normalizeCaseUploadRename,
  overwriteCaseUploadFile,
  readCaseUploadFile,
  saveCaseUploadFile,
} from "../services/case-uploads";
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
  if (
    value === "civil" ||
    value === "criminal" ||
    value === "special_administrative" ||
    value === "constitutional_writ"
  ) {
    return value;
  }
  return null;
}

function parseCaseStatus(value: unknown): LegalCaseStatus | null {
  if (value === "open" || value === "pending" || value === "closed") return value;
  return null;
}

function parseCaseParty(value: unknown): LegalCaseParty | null {
  if (value === "plaintiff" || value === "defendant" || value === "other") return value;
  return null;
}

router.get(
  "/cases",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      let filter: Record<string, unknown>;

      if (user.teamId) {
        filter = { teamId: user.teamId };
        const canReadAll = await hasRolePermission(
          skRoleKey(user.role),
          "sk.cases.read_all"
        );
        const canReadAssigned = await hasRolePermission(
          skRoleKey(user.role),
          "sk.cases.read_assigned"
        );
        if (!canReadAll && !canReadAssigned) {
          res.status(403).json({ error: "Permission denied" });
          return;
        }
        if (!canReadAll) {
          filter.assignedMemberIds = new mongoose.Types.ObjectId(user.id);
        }
      } else {
        const caseIds = await listActiveCaseIdsForAccount(user.id);
        filter = {
          _id: { $in: caseIds.map((id) => new mongoose.Types.ObjectId(id)) },
        };
      }

      // Filter by search query (case name / case no / notes)
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [
          { title: searchRegex },
          { caseNo: searchRegex },
          { notes: searchRegex },
        ];
      }

      // Filter by case type
      if (typeof req.query.type === "string" && req.query.type !== "all") {
        filter.type = req.query.type;
      }

      // Filter by case status
      if (typeof req.query.status === "string" && req.query.status !== "all") {
        filter.status = req.query.status;
      }

      const hasPaginationParams =
        req.query.page !== undefined ||
        req.query.limit !== undefined ||
        req.query.search !== undefined ||
        req.query.type !== undefined ||
        req.query.status !== undefined;

      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? "10"), 10) || 10));
      const skip = (page - 1) * limit;

      const totalCount = await LegalCase.countDocuments(filter);
      const cases = await LegalCase.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit);

      const items = cases.map((legalCase) => legalCaseToJson(legalCase));

      if (hasPaginationParams) {
        res.json({
          cases: items,
          totalCount,
          page,
          limit,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        });
      } else {
        res.json(items);
      }
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
      const { title, caseNo, type, status, partySide, notes, assignedMemberIds } = req.body as {
        title?: string;
        caseNo?: string;
        type?: string;
        status?: string;
        partySide?: string;
        notes?: string;
        assignedMemberIds?: string[];
      };

      const caseType = parseCaseType(type);
      if (!title?.trim() || !caseNo?.trim() || !caseType) {
        res.status(400).json({ error: "Title, case number, and type are required" });
        return;
      }

      const caseStatus = parseCaseStatus(status) ?? "open";
      const caseParty = parseCaseParty(partySide) ?? "plaintiff";
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
        partySide: caseParty,
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

      const { title, caseNo, type, status, partySide, notes, assignedMemberIds } = req.body as {
        title?: string;
        caseNo?: string;
        type?: string;
        status?: string;
        partySide?: string;
        notes?: string;
        assignedMemberIds?: string[];
      };

      if (title?.trim()) legalCase.title = title.trim();
      if (caseNo?.trim()) legalCase.caseNo = caseNo.trim();
      const caseType = parseCaseType(type);
      if (caseType) legalCase.type = caseType;
      const caseStatus = parseCaseStatus(status);
      if (caseStatus) legalCase.status = caseStatus;
      const caseParty = parseCaseParty(partySide);
      if (caseParty) legalCase.partySide = caseParty;
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

function skRoleKey(role: string | null | undefined) {
  if (role === "admin") return "sk.firm_admin" as const;
  if (role === "member") return "sk.member" as const;
  if (role === "caseUser") return "sk.case_user" as const;
  return "sk.individual" as const;
}

async function findAccessibleCase(req: SajiloKanunAuthRequest, caseId: string) {
  const user = req.sajiloKanunUser!;
  if (!mongoose.Types.ObjectId.isValid(caseId)) return null;

  // Case users are never treated as firm members — only linked cases.
  if (user.role === "caseUser") {
    const isParticipant = await isActiveCaseParticipant(caseId, user.id);
    if (!isParticipant) return null;
    return LegalCase.findById(caseId);
  }

  if (user.teamId) {
    const filter: Record<string, unknown> = {
      _id: caseId,
      teamId: user.teamId,
    };
    const canReadAll = await hasRolePermission(skRoleKey(user.role), "sk.cases.read_all");
    if (!canReadAll) {
      filter.assignedMemberIds = new mongoose.Types.ObjectId(user.id);
    }
    return LegalCase.findOne(filter);
  }

  const isParticipant = await isActiveCaseParticipant(caseId, user.id);
  if (!isParticipant) return null;
  return LegalCase.findById(caseId);
}

async function canReadCaseFiles(user: NonNullable<SajiloKanunAuthRequest["sajiloKanunUser"]>) {
  if (user.role === "caseUser") return true;
  if (!user.teamId) return false;
  return hasRolePermission(skRoleKey(user.role), "sk.files.read");
}

async function canUploadCaseFiles(user: NonNullable<SajiloKanunAuthRequest["sajiloKanunUser"]>) {
  if (user.role === "caseUser") return true;
  if (!user.teamId) return false;
  return hasRolePermission(skRoleKey(user.role), "sk.files.upload");
}

/** Delete/manage any file on a firm case (not limited to uploader). */
async function canManageCaseFiles(user: NonNullable<SajiloKanunAuthRequest["sajiloKanunUser"]>) {
  if (user.role === "caseUser") return false;
  if (!user.teamId) return false;
  return hasRolePermission(skRoleKey(user.role), "sk.files.manage");
}

async function canManageCaseParticipants(req: SajiloKanunAuthRequest) {
  const user = req.sajiloKanunUser!;
  if (!user.teamId || user.role !== "admin") return false;
  return hasRolePermission(skRoleKey(user.role), "sk.cases.manage");
}

function parseDocumentKind(value: unknown): LegalCaseDocumentKind | null {
  if (
    value === "firadpatra" ||
    value === "pratiuttarapatra" ||
    value === "vakalatnama" ||
    value === "warisnama" ||
    value === "nivedan_awedan"
  ) {
    return value;
  }
  return null;
}

router.get(
  "/cases/:id",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      const isFirmUser = Boolean(req.sajiloKanunUser!.teamId);
      res.json(
        legalCaseToJson(legalCase, { detail: isFirmUser, payments: true })
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load case" });
    }
  }
);

router.get(
  "/cases/:id/participants",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const participants = await CaseParticipant.find({
        caseId: legalCase._id,
        status: "active",
      }).sort({ createdAt: -1 });

      const accountIds = participants.map((p) => p.accountId);
      const accounts = await SajiloKanunAccount.find({ _id: { $in: accountIds } });
      const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

      res.json(
        participants.map((p) =>
          caseParticipantToJson(p, byId.get(p.accountId.toString()) ?? null)
        )
      );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list participants" });
    }
  }
);

router.post(
  "/cases/:id/participants",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      if (!(await canManageCaseParticipants(req))) {
        res.status(403).json({ error: "Only firm admins can add case users" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { name, username, password, contactNo, email } = req.body as {
        name?: string;
        username?: string;
        password?: string;
        contactNo?: string;
        email?: string;
      };

      const account = await createCaseClientAccount({
        name: name ?? "",
        username: username ?? "",
        password: password ?? "",
        contactNo,
        email,
        createdBy: req.sajiloKanunUser!.id,
        teamId: legalCase.teamId.toString(),
      });

      try {
        const participant = await CaseParticipant.create({
          caseId: legalCase._id,
          teamId: legalCase.teamId,
          accountId: account._id,
          status: "active",
          addedBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
        });
        res.status(201).json(caseParticipantToJson(participant, account));
      } catch (err) {
        await SajiloKanunAccount.deleteOne({ _id: account._id });
        throw err;
      }
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to add case user",
      });
    }
  }
);

router.delete(
  "/cases/:id/participants/:participantId",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      if (!(await canManageCaseParticipants(req))) {
        res.status(403).json({ error: "Only firm admins can remove case users" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const participantId = Array.isArray(req.params.participantId)
        ? req.params.participantId[0]
        : req.params.participantId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const participant = await CaseParticipant.findOne({
        _id: participantId,
        caseId: legalCase._id,
      });
      if (!participant) {
        res.status(404).json({ error: "Case user not found" });
        return;
      }

      participant.status = "revoked";
      await participant.save();
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to remove case user",
      });
    }
  }
);

router.get(
  "/cases/:id/messages",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const limit = Math.max(
        1,
        Math.min(100, parseInt(String(req.query.limit ?? "80"), 10) || 80)
      );
      const messages = await CaseMessage.find({ caseId: legalCase._id })
        .sort({ createdAt: 1, _id: 1 })
        .limit(limit);

      const senderIds = [...new Set(messages.map((m) => m.senderAccountId.toString()))];
      const accounts = await SajiloKanunAccount.find({
        _id: { $in: senderIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).select("name username");
      const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

      const user = req.sajiloKanunUser!;
      const isFirmUser = Boolean(user.teamId) && user.role !== "caseUser";
      const shouldMarkRead = String(req.query.markRead ?? "0") === "1";
      let unreadFromClient = 0;

      if (isFirmUser) {
        unreadFromClient = await countUnreadClientMessages({
          caseId: legalCase._id.toString(),
          accountId: user.id,
        });
        if (shouldMarkRead) {
          await markCaseMessagesRead({
            caseId: legalCase._id.toString(),
            teamId: legalCase.teamId.toString(),
            accountId: user.id,
            lastReadMessageId:
              messages.length > 0
                ? messages[messages.length - 1]._id.toString()
                : null,
          });
          unreadFromClient = 0;
        }
      }

      res.json({
        unreadFromClient,
        messages: messages.map((m) =>
          caseMessageToJson(m, byId.get(m.senderAccountId.toString()) ?? null)
        ),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load messages" });
    }
  }
);

router.post(
  "/cases/:id/messages/read",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const user = req.sajiloKanunUser!;
      const lastReadMessageId =
        typeof (req.body as { lastReadMessageId?: string }).lastReadMessageId ===
        "string"
          ? (req.body as { lastReadMessageId: string }).lastReadMessageId
          : null;

      await markCaseMessagesRead({
        caseId: legalCase._id.toString(),
        teamId: legalCase.teamId.toString(),
        accountId: user.id,
        lastReadMessageId,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to mark messages read",
      });
    }
  }
);

router.post(
  "/cases/:id/messages",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const body =
        typeof (req.body as { body?: string }).body === "string"
          ? (req.body as { body: string }).body.trim()
          : "";
      if (!body) {
        res.status(400).json({ error: "Message body is required" });
        return;
      }

      const user = req.sajiloKanunUser!;
      const senderType =
        user.role === "caseUser" || !user.teamId ? "client" : "firm";
      const message = await CaseMessage.create({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
        senderAccountId: new mongoose.Types.ObjectId(user.id),
        senderType,
        body,
      });

      res.status(201).json(
        caseMessageToJson(message, {
          name: user.name,
          username: user.username,
        })
      );
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to send message",
      });
    }
  }
);

router.get(
  "/cases/:id/uploads",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (!(await canReadCaseFiles(user))) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const docs = await CaseUploadedDocument.find({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      }).sort({
        createdAt: -1,
      });
      const uploaderIds = [...new Set(docs.map((d) => d.uploadedBy.toString()))];
      const accounts = await SajiloKanunAccount.find({
        _id: { $in: uploaderIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).select("name username");
      const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

      const canUpload = await canUploadCaseFiles(user);
      const canManage = await canManageCaseFiles(user);

      res.json({
        maxBytes: getCaseUploadMaxBytes(),
        accept: getCaseUploadAcceptAttribute(),
        capabilities: {
          canUpload,
          canManageFiles: canManage,
        },
        uploads: docs.map((doc) =>
          caseUploadedDocumentToJson(doc, byId.get(doc.uploadedBy.toString()) ?? null)
        ),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list uploads" });
    }
  }
);

router.post(
  "/cases/:id/uploads",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (!(await canUploadCaseFiles(user))) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (!legalCase.teamId) {
        res.status(400).json({ error: "Case is missing firm assignment" });
        return;
      }

      const { fileName, mimeType, data } = req.body as {
        fileName?: string;
        mimeType?: string;
        data?: string;
      };
      if (!fileName?.trim() || !data?.trim()) {
        res.status(400).json({ error: "fileName and data are required" });
        return;
      }

      const saved = await saveCaseUploadFile({
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
        fileName: fileName.trim(),
        mimeType: mimeType?.trim() || "application/octet-stream",
        base64Data: data,
      });

      const doc = await CaseUploadedDocument.create({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
        uploadedBy: new mongoose.Types.ObjectId(user.id),
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        size: saved.size,
        storageKey: saved.storageKey,
      });

      res.status(201).json(
        caseUploadedDocumentToJson(doc, {
          name: user.name,
          username: user.username,
        })
      );
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to upload document",
      });
    }
  }
);

router.get(
  "/cases/:id/uploads/:uploadId/download",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (!(await canReadCaseFiles(user))) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const uploadId = Array.isArray(req.params.uploadId)
        ? req.params.uploadId[0]
        : req.params.uploadId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const doc = await CaseUploadedDocument.findOne({
        _id: uploadId,
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      });
      if (!doc) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }

      const buffer = await readCaseUploadFile({
        storageKey: doc.storageKey,
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
      });
      // Default inline so preview fetches are not intercepted as downloads
      // by browsers/extensions. Use ?download=1 for force-save.
      const forceDownload =
        String(req.query.download ?? "") === "1" ||
        String(req.query.disposition ?? "") === "attachment";
      // `filename=` must be ASCII-only (Node rejects Unicode in header values).
      // Real name goes in RFC 5987 `filename*`.
      const rawName = doc.fileName.replace(/[\r\n"]/g, "_").trim() || "document";
      const asciiName =
        rawName
          .normalize("NFKD")
          .replace(/[^\x20-\x7E]/g, "_")
          .replace(/["\\]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^[.\s_]+|[.\s_]+$/g, "") || "document";
      const contentType = doc.mimeType || "application/octet-stream";
      const disposition = forceDownload ? "attachment" : "inline";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buffer);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to download document",
      });
    }
  }
);

router.patch(
  "/cases/:id/uploads/:uploadId",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const uploadId = Array.isArray(req.params.uploadId)
        ? req.params.uploadId[0]
        : req.params.uploadId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const doc = await CaseUploadedDocument.findOne({
        _id: uploadId,
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      });
      if (!doc) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }

      const user = req.sajiloKanunUser!;
      const isOwner = doc.uploadedBy.toString() === user.id;
      const canManage = await canManageCaseFiles(user);
      if (!isOwner && !canManage) {
        res.status(403).json({ error: "You can only rename documents you uploaded" });
        return;
      }
      if (isOwner && !(await canUploadCaseFiles(user)) && !canManage) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const { fileName } = req.body as { fileName?: unknown };
      if (typeof fileName !== "string" || !fileName.trim()) {
        res.status(400).json({ error: "fileName is required" });
        return;
      }

      doc.fileName = normalizeCaseUploadRename(fileName, doc.fileName);
      await doc.save();

      const uploader = await SajiloKanunAccount.findById(doc.uploadedBy).select(
        "name username"
      );
      res.json(caseUploadedDocumentToJson(doc, uploader));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to rename document",
      });
    }
  }
);

router.put(
  "/cases/:id/uploads/:uploadId",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (!(await canUploadCaseFiles(user))) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const uploadId = Array.isArray(req.params.uploadId)
        ? req.params.uploadId[0]
        : req.params.uploadId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const doc = await CaseUploadedDocument.findOne({
        _id: uploadId,
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      });
      if (!doc) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }

      const kind = getCaseUploadEditableKind(doc.fileName, doc.mimeType);
      if (!kind) {
        res.status(400).json({
          error: "Only .txt and .docx files can be edited in the browser",
        });
        return;
      }

      const { content } = req.body as { content?: unknown };
      if (typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      let buffer: Buffer;
      if (kind === "txt") {
        buffer = Buffer.from(content, "utf8");
      } else {
        const HTMLtoDOCX = (await import("html-to-docx")).default;
        const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${content}</body></html>`;
        const docxResult = await HTMLtoDOCX(wrapped, null, {
          table: { row: { cantSplit: true } },
          footer: false,
          pageNumber: false,
        });
        buffer = Buffer.isBuffer(docxResult)
          ? docxResult
          : Buffer.from(docxResult as ArrayBuffer);
      }

      const saved = await overwriteCaseUploadFile({
        storageKey: doc.storageKey,
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        buffer,
      });

      doc.size = saved.size;
      doc.mimeType = saved.mimeType;
      await doc.save();

      res.json(
        caseUploadedDocumentToJson(doc, {
          name: user.name,
          username: user.username,
        })
      );
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to save document",
      });
    }
  }
);

router.delete(
  "/cases/:id/uploads/:uploadId",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const uploadId = Array.isArray(req.params.uploadId)
        ? req.params.uploadId[0]
        : req.params.uploadId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const doc = await CaseUploadedDocument.findOne({
        _id: uploadId,
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      });
      if (!doc) {
        res.status(404).json({ error: "Upload not found" });
        return;
      }

      const user = req.sajiloKanunUser!;
      const isOwner = doc.uploadedBy.toString() === user.id;
      const canManage = await canManageCaseFiles(user);
      // caseUser / members without manage: only own uploads.
      // Firm admin (or role with sk.files.manage): any file on this firm case.
      if (!isOwner && !canManage) {
        res.status(403).json({ error: "You can only remove documents you uploaded" });
        return;
      }
      if (isOwner && !(await canUploadCaseFiles(user)) && !canManage) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      await deleteCaseUploadFile({
        storageKey: doc.storageKey,
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
      });
      await doc.deleteOne();
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to delete document",
      });
    }
  }
);

router.post(
  "/cases/:id/testimonials",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { contactName, contactPhone, content } = req.body as {
        contactName?: string;
        contactPhone?: string;
        content?: string;
      };

      if (!contactName?.trim() || !contactPhone?.trim() || !content?.trim()) {
        res.status(400).json({
          error: "Contact name, phone number, and testimonial content are required",
        });
        return;
      }

      legalCase.testimonials.push({
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        content: content.trim(),
        createdBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
        createdAt: new Date(),
      } as never);

      await legalCase.save();
      res.status(201).json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to add testimonial",
      });
    }
  }
);

router.delete(
  "/cases/:id/testimonials/:itemId",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const itemId = Array.isArray(req.params.itemId)
        ? req.params.itemId[0]
        : req.params.itemId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const before = legalCase.testimonials.length;
      legalCase.testimonials = legalCase.testimonials.filter(
        (item) => item._id.toString() !== itemId
      );
      if (legalCase.testimonials.length === before) {
        res.status(404).json({ error: "Testimonial not found" });
        return;
      }

      await legalCase.save();
      res.json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to delete testimonial",
      });
    }
  }
);

router.post(
  "/cases/:id/payments",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { amount, currency, method, note, paidAt } = req.body as {
        amount?: number | string;
        currency?: string;
        method?: string;
        note?: string;
        paidAt?: string;
      };

      const parsedAmount = typeof amount === "number" ? amount : Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        res.status(400).json({ error: "A valid payment amount is required" });
        return;
      }

      const paidDate = paidAt ? new Date(paidAt) : new Date();
      if (Number.isNaN(paidDate.getTime())) {
        res.status(400).json({ error: "Invalid payment date" });
        return;
      }

      legalCase.payments.push({
        amount: parsedAmount,
        currency: currency?.trim() || "NPR",
        method: method?.trim() || "",
        note: note?.trim() || "",
        paidAt: paidDate,
        createdBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
        createdAt: new Date(),
      } as never);

      await legalCase.save();
      res.status(201).json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to add payment",
      });
    }
  }
);

router.delete(
  "/cases/:id/payments/:itemId",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const itemId = Array.isArray(req.params.itemId)
        ? req.params.itemId[0]
        : req.params.itemId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const before = legalCase.payments.length;
      legalCase.payments = legalCase.payments.filter(
        (item) => item._id.toString() !== itemId
      );
      if (legalCase.payments.length === before) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      await legalCase.save();
      res.json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to delete payment",
      });
    }
  }
);

router.get(
  "/dashboard/unread-messages",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      const teamId = user.teamId!;
      const caseFilter: Record<string, unknown> = { teamId };
      const canReadAll = await hasRolePermission(
        skRoleKey(user.role),
        "sk.cases.read_all"
      );
      if (!canReadAll) {
        caseFilter.assignedMemberIds = new mongoose.Types.ObjectId(user.id);
      }

      const cases = await LegalCase.find(caseFilter).select("_id").lean();
      const caseIds = cases.map((legalCase) => legalCase._id);
      const unread = await listUnreadClientThreadsForAccount({
        accountId: user.id,
        caseIds,
      });

      res.json(unread);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load unread messages" });
    }
  }
);

router.get(
  "/dashboard/activities",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      const teamId = user.teamId!;
      const caseFilter: Record<string, unknown> = { teamId };
      const canReadAll = await hasRolePermission(
        skRoleKey(user.role),
        "sk.cases.read_all"
      );
      if (!canReadAll) {
        caseFilter.assignedMemberIds = new mongoose.Types.ObjectId(user.id);
      }

      const cases = await LegalCase.find(caseFilter)
        .select("_id title caseNo status type partySide")
        .lean();
      const caseById = new Map(
        cases.map((legalCase) => [legalCase._id.toString(), legalCase])
      );
      const caseIds = cases.map((legalCase) => legalCase._id);

      if (caseIds.length === 0) {
        res.json({
          summary: {
            total: 0,
            overdue: 0,
            dueToday: 0,
            dueThisWeek: 0,
            upcoming: 0,
            openCases: 0,
          },
          activities: [],
        });
        return;
      }

      const activities = await CaseActivity.find({
        teamId,
        caseId: { $in: caseIds },
      }).sort({ activityDate: 1, _id: 1 });

      const now = new Date();
      const startOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      const endOfToday = new Date(startOfToday.getTime() + 86_400_000 - 1);
      const endOfWeek = new Date(startOfToday.getTime() + 7 * 86_400_000 - 1);

      let overdue = 0;
      let dueToday = 0;
      let dueThisWeek = 0;
      let upcoming = 0;

      const rows = activities.map((activity) => {
        const legalCase = caseById.get(activity.caseId.toString());
        const activityTime = activity.activityDate.getTime();
        let urgency: "overdue" | "today" | "week" | "upcoming" | "past" = "upcoming";
        if (activityTime < startOfToday.getTime()) {
          urgency = "overdue";
          overdue += 1;
        } else if (activityTime <= endOfToday.getTime()) {
          urgency = "today";
          dueToday += 1;
        } else if (activityTime <= endOfWeek.getTime()) {
          urgency = "week";
          dueThisWeek += 1;
          upcoming += 1;
        } else {
          urgency = "upcoming";
          upcoming += 1;
        }

        return {
          ...caseActivityToJson(activity),
          urgency,
          caseTitle: legalCase?.title ?? "",
          caseNo: legalCase?.caseNo ?? "",
          caseStatus: legalCase?.status ?? "open",
          caseType: legalCase?.type ?? "civil",
          partySide: legalCase?.partySide ?? "plaintiff",
        };
      });

      // Pending-first report: overdue + today + future, soonest dates first.
      // Keep past/overdue at top for action, then today, then upcoming.
      const urgencyRank: Record<string, number> = {
        overdue: 0,
        today: 1,
        week: 2,
        upcoming: 3,
      };
      rows.sort((a, b) => {
        const rankDiff = (urgencyRank[a.urgency] ?? 9) - (urgencyRank[b.urgency] ?? 9);
        if (rankDiff !== 0) return rankDiff;
        return +new Date(a.activityDate) - +new Date(b.activityDate);
      });

      const openCases = cases.filter((legalCase) => legalCase.status !== "closed").length;

      res.json({
        summary: {
          total: rows.length,
          overdue,
          dueToday,
          dueThisWeek,
          upcoming,
          openCases,
        },
        activities: rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load firm activity dashboard" });
    }
  }
);

router.get(
  "/cases/:id/activities",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const activities = await CaseActivity.find({ caseId: legalCase._id }).sort({
        activityDate: -1,
        _id: -1,
      });
      const creatorIds = [...new Set(activities.map((a) => a.createdBy.toString()))];
      const accounts = await SajiloKanunAccount.find({
        _id: { $in: creatorIds.map((id) => new mongoose.Types.ObjectId(id)) },
      }).select("name username");
      const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

      res.json({
        activities: activities.map((activity) =>
          caseActivityToJson(activity, byId.get(activity.createdBy.toString()) ?? null)
        ),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list activities" });
    }
  }
);

router.post(
  "/cases/:id/activities",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const { activityType, bsYear, bsMonth, bsDay, activityDate, note } = req.body as {
        activityType?: string;
        bsYear?: number | string;
        bsMonth?: number | string;
        bsDay?: number | string;
        activityDate?: string;
        note?: string;
      };

      if (
        !activityType ||
        !CASE_ACTIVITY_TYPES.includes(activityType as CaseActivityType)
      ) {
        res.status(400).json({ error: "A valid activity type is required" });
        return;
      }

      const year = Number(bsYear);
      const month = Number(bsMonth);
      const day = Number(bsDay);
      if (
        !Number.isInteger(year) ||
        year < 2000 ||
        year > 2100 ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12 ||
        !Number.isInteger(day) ||
        day < 1 ||
        day > 32
      ) {
        res.status(400).json({ error: "A valid Nepali (BS) date is required" });
        return;
      }

      const parsedDate = activityDate ? new Date(activityDate) : new Date();
      if (Number.isNaN(parsedDate.getTime())) {
        res.status(400).json({ error: "Invalid activity date" });
        return;
      }

      const activity = await CaseActivity.create({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
        activityType: activityType as CaseActivityType,
        bsYear: year,
        bsMonth: month,
        bsDay: day,
        activityDate: parsedDate,
        note: note?.trim() || "",
        createdBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
      });

      res.status(201).json(
        caseActivityToJson(activity, {
          name: req.sajiloKanunUser!.name,
          username: req.sajiloKanunUser!.username,
        })
      );
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to add activity",
      });
    }
  }
);

router.delete(
  "/cases/:id/activities/:activityId",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const activityId = Array.isArray(req.params.activityId)
        ? req.params.activityId[0]
        : req.params.activityId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const activity = await CaseActivity.findOne({
        _id: activityId,
        caseId: legalCase._id,
      });
      if (!activity) {
        res.status(404).json({ error: "Activity not found" });
        return;
      }

      const user = req.sajiloKanunUser!;
      const isOwner = activity.createdBy.toString() === user.id;
      const isFirmUser = Boolean(user.teamId) && user.role !== "caseUser";
      if (!isOwner && !isFirmUser) {
        res.status(403).json({ error: "You can only remove activities you created" });
        return;
      }

      await activity.deleteOne();
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to delete activity",
      });
    }
  }
);

router.post(
  "/cases/:id/documents/generate",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const kind = parseDocumentKind((req.body as { kind?: string }).kind);
      if (!kind) {
        res.status(400).json({ error: "A valid document kind is required" });
        return;
      }

      const title = LEGAL_CASE_DOCUMENT_TITLES[kind];
      const now = new Date();
      legalCase.documents.push({
        kind,
        title,
        status: "placeholder",
        content:
          `[Placeholder] ${title} for case ${legalCase.caseNo} (${legalCase.title}).\n` +
          `AI document generation will be connected in a later phase.`,
        createdBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
        createdAt: now,
        updatedAt: now,
      } as never);

      await legalCase.save();
      res.status(201).json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to generate document",
      });
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
