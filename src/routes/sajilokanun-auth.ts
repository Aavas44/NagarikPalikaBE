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
  COURT_TYPE_META,
  parseCourtType,
  type CourtType,
} from "../lib/court-type";
import {
  SajiloKanunDocumentTemplate,
  sajiloKanunDocumentTemplateToJson,
} from "../models/SajiloKanunDocumentTemplate";
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
  CasePesiRow,
  CASE_PESI_COLUMNS,
  casePesiRowToJson,
} from "../models/CasePesiRow";
import {
  caseNoMatches,
  fetchAndMatchCasePesi,
  fetchCourtWeeklyPesiRows,
  parseBsDateString,
} from "../services/supreme-court-pesi";
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
  saveCaseUploadBuffer,
  saveCaseUploadFile,
} from "../services/case-uploads";
import {
  asciiZipFileName,
  generatedDraftFileName,
  plaintextToDocxBuffer,
  zipCaseUploads,
} from "../services/case-file-export";
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
import {
  assertFirmCanCreateCase,
  assertFirmCanGenerateDocument,
  getFirmQuotaSnapshot,
  reserveFirmAiQuery,
} from "../services/firm-quotas";
import { listCourtsGrouped, resolveCourtByIdOrCode } from "../services/courts";
import { User, userToJson } from "../models/User";
import { signToken } from "../middleware/auth";
import { findWardOperatorForLogin } from "../services/ward-operator-auth";
import { createCitizenSession } from "./auth";

const router = Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username?.trim() || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const identifier = username.trim().toLowerCase();
    const account = await SajiloKanunAccount.findOne({
      username: identifier,
      active: true,
    });

    if (!account) {
      const platformUser = await User.findOne({
        email: identifier,
        userType: { $in: ["admin", "superadmin"] },
      });
      if (platformUser?.passwordHash) {
        const platformValid = await bcrypt.compare(password, platformUser.passwordHash);
        if (platformValid) {
          const token = signToken({
            id: platformUser._id.toString(),
            email: platformUser.email,
            name: platformUser.name,
            userType: platformUser.userType,
          });
          res.json({
            kind: "platform",
            token,
            user: userToJson(platformUser),
            redirect: "/admin",
          });
          return;
        }
      }

      const wardMatch = await findWardOperatorForLogin(identifier);
      if (wardMatch?.user.passwordHash) {
        const wardValid = await bcrypt.compare(password, wardMatch.user.passwordHash);
        if (wardValid) {
          if (!wardMatch.profile.active) {
            res.status(403).json({ error: "This ward operator account is inactive" });
            return;
          }
          const token = signToken({
            id: wardMatch.user._id.toString(),
            email: wardMatch.user.email,
            name: wardMatch.user.name,
            userType: wardMatch.user.userType,
          });
          res.json({
            kind: "platform",
            token,
            user: userToJson(wardMatch.user),
            redirect: "/ward",
          });
          return;
        }
      }

      if (identifier.includes("@")) {
        const citizen = await User.findOne({
          email: identifier,
          userType: "user",
        });
        if (citizen?.passwordHash) {
          const citizenValid = await bcrypt.compare(password, citizen.passwordHash);
          if (citizenValid) {
            const session = await createCitizenSession(citizen, citizen.passwordHash);
            res.json({
              kind: "citizen",
              token: session.token,
              sajiloKanunToken: session.sajiloKanunToken,
              user: session.user,
              redirect: "/sajilokanun/chat",
            });
            return;
          }
        }
      }

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
      kind: "sajilo_kanun",
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

      // Firm users (admin/member) share a firm-level AI pool when a limit is set.
      if (user.teamId && user.role !== "caseUser") {
        if (req.query.consume !== "1") {
          const firmQuota = await getFirmQuotaSnapshot(user.teamId);
          res.json({
            allowed: true,
            quota: firmQuota.aiRequests,
            firmQuota,
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
        const quota = await reserveFirmAiQuery(
          user.teamId,
          typeof questionId === "string" ? questionId : "",
          typeof questionHash === "string" ? questionHash : ""
        );
        if (!quota.allowed) {
          const status =
            quota.reason === "question_identity_required" ? 400 : 429;
          const firmQuota = await getFirmQuotaSnapshot(user.teamId);
          res.status(status).json({
            error:
              status === 429
                ? "Your firm has used its allocated AI requests."
                : "A valid question identity is required.",
            code: status === 429 ? "firm_ai_quota" : undefined,
            used: quota.used,
            limit: quota.limit,
            quota: {
              limit: quota.limit,
              used: quota.used,
              remaining: quota.remaining,
              questionId: quota.questionId ?? null,
            },
            firmQuota,
          });
          return;
        }
        const firmQuota = await getFirmQuotaSnapshot(user.teamId);
        res.json({
          allowed: true,
          quota: {
            limit: quota.limit,
            used: quota.used,
            remaining: quota.remaining,
            questionId: quota.questionId ?? null,
          },
          firmQuota,
        });
        return;
      }

      // Case users / roles without firm AI: deny via permission usually;
      // keep unlimited only when somehow authorized without team.
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
      if (user.teamId && user.role !== "caseUser") {
        const firmQuota = await getFirmQuotaSnapshot(user.teamId);
        res.json({
          quota: firmQuota.aiRequests,
          firmQuota,
          plan: "firm",
        });
        return;
      }
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

/** Nepal court catalog (special / high / district) for case forms. */
router.get("/courts", requireSajiloKanunAuth, async (_req, res) => {
  try {
    const data = await listCourtsGrouped();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load courts" });
  }
});

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

      // Firm admins/members must be scoped to their firm only.
      if (user.role === "admin" || user.role === "member") {
        if (!user.teamId) {
          res.status(403).json({
            error: "This account is not assigned to a law firm",
          });
          return;
        }
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
      } else if (user.teamId && user.role !== "caseUser") {
        // Individual/legacy accounts with a teamId
        filter = { teamId: user.teamId };
      } else {
        // Case users (and accounts without a firm): only participant cases
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
      const {
        title,
        caseNo,
        type,
        status,
        partySide,
        notes,
        assignedMemberIds,
        courtId,
        courtCode,
        courtType: courtTypeRaw,
        documentExtraction,
      } =
        req.body as {
          title?: string;
          caseNo?: string;
          type?: string;
          status?: string;
          partySide?: string;
          notes?: string;
          assignedMemberIds?: string[];
          courtId?: string;
          courtCode?: string;
          courtType?: string;
          documentExtraction?: {
            facts?: unknown;
            sourceFileNames?: unknown;
            model?: unknown;
          };
        };

      const caseType = parseCaseType(type);
      if (!title?.trim() || !caseNo?.trim() || !caseType) {
        res.status(400).json({ error: "Title, case number, and type are required" });
        return;
      }

      const courtType = parseCourtType(courtTypeRaw);
      if (!courtType) {
        res.status(400).json({
          error:
            "Court type is required (जिल्ला अदालत / उच्च अदालत / सर्वोच्च अदालत / विशेष अदालत)",
        });
        return;
      }

      const courtMeta = COURT_TYPE_META[courtType];
      let courtFields: {
        courtId: mongoose.Types.ObjectId | null;
        courtCode: string | null;
        courtName: string;
        courtNameEn: string | null;
        courtScDailyId: number | null;
        courtCategory: "special_courts" | "high_courts" | "district_courts" | null;
        courtType: CourtType;
      };

      if (courtType === "supreme") {
        courtFields = {
          courtId: null,
          courtCode: "supreme_court",
          courtName: courtMeta.defaultCourtNameNe,
          courtNameEn: courtMeta.defaultCourtNameEn,
          courtScDailyId: null,
          courtCategory: null,
          courtType,
        };
      } else {
        const court = await resolveCourtByIdOrCode({ courtId, courtCode });
        if (!court) {
          res.status(400).json({ error: "A valid court is required for this court type" });
          return;
        }
        if (
          courtMeta.catalogCategory &&
          court.courtCategory !== courtMeta.catalogCategory
        ) {
          res.status(400).json({
            error: "Selected court does not match the chosen court type",
          });
          return;
        }
        courtFields = {
          courtId: new mongoose.Types.ObjectId(court.courtId),
          courtCode: court.courtCode,
          courtName: court.courtName,
          courtNameEn: court.courtNameEn,
          courtScDailyId: court.courtScDailyId,
          courtCategory: court.courtCategory,
          courtType,
        };
      }

      const caseStatus = parseCaseStatus(status) ?? "open";
      const caseParty = parseCaseParty(partySide) ?? "plaintiff";
      const teamId = req.sajiloKanunUser!.teamId!;

      const caseQuota = await assertFirmCanCreateCase(teamId);
      if (!caseQuota.allowed) {
        res.status(429).json({
          error: caseQuota.error,
          code: caseQuota.code,
          used: caseQuota.used,
          limit: caseQuota.limit,
          firmQuota: caseQuota.quota,
        });
        return;
      }

      const memberIds = await validateAssignedMembers(
        teamId,
        assignedMemberIds ?? []
      );

      let extractionFields: {
        documentExtraction?: {
          facts: Record<string, unknown>;
          sourceFileNames: string[];
          model: string;
          updatedBy: mongoose.Types.ObjectId;
          createdAt: Date;
          updatedAt: Date;
        };
      } = {};

      if (
        documentExtraction?.facts &&
        typeof documentExtraction.facts === "object" &&
        !Array.isArray(documentExtraction.facts)
      ) {
        const serialized = JSON.stringify(documentExtraction.facts);
        if (serialized.length > 200_000) {
          res.status(400).json({ error: "Extraction payload is too large" });
          return;
        }
        const sourceFileNames = Array.isArray(documentExtraction.sourceFileNames)
          ? documentExtraction.sourceFileNames
              .filter((name): name is string => typeof name === "string")
              .map((name) => name.trim())
              .filter(Boolean)
              .slice(0, 20)
          : [];
        const model =
          typeof documentExtraction.model === "string" && documentExtraction.model.trim()
            ? documentExtraction.model.trim().slice(0, 120)
            : "";
        const now = new Date();
        extractionFields = {
          documentExtraction: {
            facts: documentExtraction.facts as Record<string, unknown>,
            sourceFileNames,
            model,
            updatedBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
            createdAt: now,
            updatedAt: now,
          },
        };
      }

      const legalCase = await LegalCase.create({
        teamId,
        title: title.trim(),
        caseNo: caseNo.trim(),
        type: caseType,
        status: caseStatus,
        partySide: caseParty,
        notes: notes?.trim(),
        ...courtFields,
        assignedMemberIds: memberIds,
        createdBy: req.sajiloKanunUser!.id,
        ...extractionFields,
      });

      res.status(201).json(legalCaseToJson(legalCase, { detail: true }));
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

      const {
        title,
        caseNo,
        type,
        status,
        partySide,
        notes,
        assignedMemberIds,
        courtId,
        courtCode,
        courtType: courtTypeRaw,
      } = req.body as {
        title?: string;
        caseNo?: string;
        type?: string;
        status?: string;
        partySide?: string;
        notes?: string;
        assignedMemberIds?: string[];
        courtId?: string | null;
        courtCode?: string | null;
        courtType?: string | null;
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

      const nextCourtType =
        courtTypeRaw === undefined
          ? legalCase.courtType ?? null
          : parseCourtType(courtTypeRaw);
      if (courtTypeRaw !== undefined && !nextCourtType) {
        res.status(400).json({ error: "Invalid court type" });
        return;
      }

      if (courtTypeRaw !== undefined || courtId !== undefined || courtCode !== undefined) {
        const courtType =
          nextCourtType ??
          parseCourtType(legalCase.courtType) ??
          null;
        if (!courtType) {
          res.status(400).json({ error: "Court type is required" });
          return;
        }
        const courtMeta = COURT_TYPE_META[courtType];
        if (courtType === "supreme") {
          legalCase.courtId = null;
          legalCase.courtCode = "supreme_court";
          legalCase.courtName = courtMeta.defaultCourtNameNe;
          legalCase.courtNameEn = courtMeta.defaultCourtNameEn;
          legalCase.courtScDailyId = null;
          legalCase.courtCategory = null;
          legalCase.courtType = courtType;
        } else {
          const court = await resolveCourtByIdOrCode({
            courtId:
              courtId === undefined
                ? legalCase.courtId?.toString()
                : courtId,
            courtCode:
              courtCode === undefined
                ? legalCase.courtCode
                : courtCode,
          });
          if (!court) {
            res.status(400).json({ error: "A valid court is required for this court type" });
            return;
          }
          if (
            courtMeta.catalogCategory &&
            court.courtCategory !== courtMeta.catalogCategory
          ) {
            res.status(400).json({
              error: "Selected court does not match the chosen court type",
            });
            return;
          }
          legalCase.courtId = new mongoose.Types.ObjectId(court.courtId);
          legalCase.courtCode = court.courtCode;
          legalCase.courtName = court.courtName;
          legalCase.courtNameEn = court.courtNameEn;
          legalCase.courtScDailyId = court.courtScDailyId;
          legalCase.courtCategory = court.courtCategory;
          legalCase.courtType = courtType;
        }
      }
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

  // Firm admin/member: always require team scope — never fall through to
  // participant-only access (that would leak cross-firm if mis-assigned).
  if (user.role === "admin" || user.role === "member") {
    if (!user.teamId) return null;
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
    value === "nivedan_awedan" ||
    value === "adhikrit_warisnama" ||
    value === "sadharan_warisnama" ||
    value === "manjurinama" ||
    value === "sampatti_rokka_nivedan" ||
    value === "sampatti_fukuwa_nivedan" ||
    value === "tayari_fatbari_nivedan" ||
    value === "court_fee_subidha_nivedan" ||
    value === "milis_jhikaune_nivedan" ||
    value === "petboli_manish_bhuji_nivedan" ||
    value === "sakkal_kagaj_pesh_nivedan" ||
    value === "hajir_huna_aayeko_nivedan"
  ) {
    return value;
  }
  return null;
}

/** Published official / firm document templates for a court tier. */
router.get(
  "/document-templates",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const courtType = parseCourtType(
        Array.isArray(req.query.courtType)
          ? req.query.courtType[0]
          : req.query.courtType
      );
      if (!courtType) {
        res.status(400).json({ error: "A valid courtType is required" });
        return;
      }

      const templates = await SajiloKanunDocumentTemplate.find({
        courtType,
        status: "published",
      }).sort({ nameNe: 1, nameEn: 1, documentKind: 1 });

      res.json(templates.map(sajiloKanunDocumentTemplateToJson));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list document templates" });
    }
  }
);

router.put(
  "/starred-document-templates/:templateId",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const templateId = Array.isArray(req.params.templateId)
        ? req.params.templateId[0]
        : req.params.templateId;
      if (!templateId || !mongoose.Types.ObjectId.isValid(templateId)) {
        res.status(400).json({ error: "Invalid template id" });
        return;
      }
      const starred = (req.body as { starred?: boolean }).starred;
      if (typeof starred !== "boolean") {
        res.status(400).json({ error: "starred boolean is required" });
        return;
      }

      const template = await SajiloKanunDocumentTemplate.findOne({
        _id: templateId,
        status: "published",
      });
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const oid = new mongoose.Types.ObjectId(templateId);
      await SajiloKanunAccount.updateOne(
        { _id: req.sajiloKanunUser!.id },
        starred
          ? { $addToSet: { starredDocumentTemplateIds: oid } }
          : { $pull: { starredDocumentTemplateIds: oid } }
      );

      const updated = await SajiloKanunAccount.findById(req.sajiloKanunUser!.id);
      res.json({
        starredDocumentTemplateIds: (
          updated?.starredDocumentTemplateIds ?? []
        ).map((id) => id.toString()),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update starred template" });
    }
  }
);

router.get(
  "/document-templates/:id/fields",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const template = await SajiloKanunDocumentTemplate.findOne({
        _id: id,
        status: "published",
      });
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }
      const {
        getSkTemplateFormFields,
      } = await import("../services/sk-document-generation");
      res.json(await getSkTemplateFormFields(template));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error:
          err instanceof Error ? err.message : "Failed to load template fields",
      });
    }
  }
);

async function loadPublishedSkTemplate(templateId: string) {
  return SajiloKanunDocumentTemplate.findOne({
    _id: templateId,
    status: "published",
  });
}

router.post(
  "/cases/:id/document-templates/preview",
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

      const { templateId, variables } = req.body as {
        templateId?: string;
        variables?: Record<string, string | number>;
      };
      if (!templateId?.trim()) {
        res.status(400).json({ error: "templateId is required" });
        return;
      }

      const template = await loadPublishedSkTemplate(templateId);
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const { generateSkDocument } = await import(
        "../services/sk-document-generation"
      );
      const result = await generateSkDocument(template, variables ?? {}, {
        validateRequired: false,
        forPreview: true,
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(result.fileName)}"`
      );
      res.send(result.buffer);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to preview document",
      });
    }
  }
);

router.post(
  "/cases/:id/document-templates/generate",
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

      const { templateId, variables, allowIncomplete } = req.body as {
        templateId?: string;
        variables?: Record<string, string | number>;
        allowIncomplete?: boolean;
      };
      if (!templateId?.trim()) {
        res.status(400).json({ error: "templateId is required" });
        return;
      }

      const template = await loadPublishedSkTemplate(templateId);
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const teamId = legalCase.teamId?.toString();
      if (teamId) {
        const docQuota = await assertFirmCanGenerateDocument(teamId);
        if (!docQuota.allowed) {
          res.status(429).json({
            error: docQuota.error,
            code: docQuota.code,
            used: docQuota.used,
            limit: docQuota.limit,
            firmQuota: docQuota.quota,
          });
          return;
        }
      }

      const { generateSkDocument } = await import(
        "../services/sk-document-generation"
      );
      const result = await generateSkDocument(template, variables ?? {}, {
        validateRequired: allowIncomplete !== true,
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(result.fileName)}"`
      );
      res.send(result.buffer);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error:
          err instanceof Error ? err.message : "Failed to generate document",
      });
    }
  }
);

/**
 * Gemini maps case OCR + form hints onto template fields, then fills the existing DOCX.
 * Returns filled values so the client can preview / download / save.
 */
router.post(
  "/cases/:id/document-templates/generate-ai",
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

      const { templateId, variables } = req.body as {
        templateId?: string;
        variables?: Record<string, string | number>;
      };
      if (!templateId?.trim()) {
        res.status(400).json({ error: "templateId is required" });
        return;
      }

      const template = await loadPublishedSkTemplate(templateId);
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const teamId = legalCase.teamId?.toString();
      if (teamId) {
        const docQuota = await assertFirmCanGenerateDocument(teamId);
        if (!docQuota.allowed) {
          res.status(429).json({
            error: docQuota.error,
            code: docQuota.code,
            used: docQuota.used,
            limit: docQuota.limit,
            firmQuota: docQuota.quota,
          });
          return;
        }
      }

      const {
        getSkTemplateFormFields,
        generateSkDocument,
      } = await import("../services/sk-document-generation");
      const { aiFillSkTemplateValues } = await import(
        "../services/sk-ai-fill-template"
      );

      const fields = await getSkTemplateFormFields(template);
      const userValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(variables ?? {})) {
        userValues[key] =
          value === undefined || value === null ? "" : String(value).trim();
      }

      const caseVitals =
        legalCase.documentExtraction?.facts &&
        typeof legalCase.documentExtraction.facts === "object"
          ? (legalCase.documentExtraction.facts as Record<string, unknown>)
          : null;

      const filled = await aiFillSkTemplateValues({
        templateName:
          template.nameNe || template.nameEn || template.slug || templateId,
        fields: fields.userFields.map((f) => ({
          key: f.key,
          labelEn: f.label.en,
          labelNe: f.label.ne,
          section: f.section,
        })),
        caseVitals,
        userValues,
      });

      // Validate by rendering (no preview markers)
      const result = await generateSkDocument(template, filled.values, {
        validateRequired: false,
      });

      res.json({
        values: filled.values,
        filledCount: filled.filledCount,
        fileName: result.fileName,
        contentType: result.contentType,
        contentBase64: result.buffer.toString("base64"),
      });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to AI-generate document",
      });
    }
  }
);

router.post(
  "/cases/:id/document-templates/save",
  requireSajiloKanunAuth,
  requireSkTeamMember,
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

      const { templateId, variables, allowIncomplete } = req.body as {
        templateId?: string;
        variables?: Record<string, string | number>;
        allowIncomplete?: boolean;
      };
      if (!templateId?.trim()) {
        res.status(400).json({ error: "templateId is required" });
        return;
      }

      const template = await loadPublishedSkTemplate(templateId);
      if (!template) {
        res.status(404).json({ error: "Published template not found" });
        return;
      }

      const teamId = legalCase.teamId.toString();
      const docQuota = await assertFirmCanGenerateDocument(teamId);
      if (!docQuota.allowed) {
        res.status(429).json({
          error: docQuota.error,
          code: docQuota.code,
          used: docQuota.used,
          limit: docQuota.limit,
          firmQuota: docQuota.quota,
        });
        return;
      }

      const { generateSkDocument } = await import(
        "../services/sk-document-generation"
      );
      const result = await generateSkDocument(template, variables ?? {}, {
        validateRequired: allowIncomplete !== true,
      });

      const saved = await saveCaseUploadBuffer({
        teamId,
        caseId: legalCase._id.toString(),
        fileName: result.fileName,
        mimeType: result.contentType,
        buffer: result.buffer,
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

      res.status(201).json({
        upload: caseUploadedDocumentToJson(doc, {
          name: user.name,
          username: user.username,
        }),
        fileName: saved.fileName,
      });
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to save generated document",
      });
    }
  }
);

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
  "/cases/:id/export",
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

      const uploads = await CaseUploadedDocument.find({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
      }).sort({ createdAt: 1 });

      if (uploads.length === 0) {
        res.status(404).json({
          error:
            "No case files to export. Save generated drafts and uploads first.",
        });
        return;
      }

      const zipBuffer = await zipCaseUploads({
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
        uploads,
      });

      const asciiName = asciiZipFileName(legalCase.caseNo);
      const displayName = `case-${legalCase.caseNo}-files.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(displayName)}`
      );
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(zipBuffer);
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to export case files",
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
        .select("_id title caseNo status type partySide courtName courtNameEn")
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
          pesiRows: [],
        });
        return;
      }

      const [activities, pesiDocs] = await Promise.all([
        CaseActivity.find({
          teamId,
          caseId: { $in: caseIds },
        }).sort({ activityDate: 1, _id: 1 }),
        CasePesiRow.find({
          teamId,
          caseId: { $in: caseIds },
        }).sort({ pesiDate: 1, _id: 1 }),
      ]);

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

      function bumpUrgency(
        urgency: "overdue" | "today" | "week" | "upcoming" | "past"
      ) {
        if (urgency === "overdue") overdue += 1;
        else if (urgency === "today") dueToday += 1;
        else if (urgency === "week") {
          dueThisWeek += 1;
          upcoming += 1;
        } else if (urgency === "upcoming") upcoming += 1;
      }

      function urgencyFromAdDate(activityTime: number) {
        if (activityTime < startOfToday.getTime()) return "overdue" as const;
        if (activityTime <= endOfToday.getTime()) return "today" as const;
        if (activityTime <= endOfWeek.getTime()) return "week" as const;
        return "upcoming" as const;
      }

      const rows = activities.map((activity) => {
        const legalCase = caseById.get(activity.caseId.toString());
        const urgency = urgencyFromAdDate(activity.activityDate.getTime());
        bumpUrgency(urgency);

        return {
          ...caseActivityToJson(activity),
          urgency,
          caseTitle: legalCase?.title ?? "",
          caseNo: legalCase?.caseNo ?? "",
          caseStatus: legalCase?.status ?? "open",
          caseType: legalCase?.type ?? "civil",
          partySide: legalCase?.partySide ?? "plaintiff",
          courtName: legalCase?.courtName ?? "",
          courtNameEn: legalCase?.courtNameEn ?? "",
        };
      });

      // Soonest remaining first (fewest days left / most overdue at top).
      rows.sort(
        (a, b) => +new Date(a.activityDate) - +new Date(b.activityDate)
      );

      const pesiRows = pesiDocs
        .map((pesi) => {
          const legalCase = caseById.get(pesi.caseId.toString());
          const bs = parseBsDateString(pesi.pesiDate);
          // Fallback: treat unparsable dates as upcoming so they still appear under "all".
          const bsYear = bs?.year ?? 2100;
          const bsMonth = bs?.month ?? 1;
          const bsDay = bs?.day ?? 1;
          // Approximate AD for server-side urgency buckets (frontend re-filters by BS remaining days).
          const approxAd = new Date(Date.UTC(bsYear - 57, bsMonth - 1, bsDay));
          const urgency = bs
            ? urgencyFromAdDate(approxAd.getTime())
            : ("upcoming" as const);
          bumpUrgency(urgency);

          return {
            ...casePesiRowToJson(pesi),
            urgency,
            bsYear,
            bsMonth,
            bsDay,
            activityType: "hearing_date" as const,
            labelEn: "Court-published activities",
            labelNe: "अदालतमा प्रकाशित गतिविधिहरू",
            caseTitle: legalCase?.title ?? "",
            caseNo: legalCase?.caseNo ?? "",
            caseStatus: legalCase?.status ?? "open",
            caseType: legalCase?.type ?? "civil",
            partySide: legalCase?.partySide ?? "plaintiff",
            courtName: legalCase?.courtName ?? "",
            courtNameEn: legalCase?.courtNameEn ?? "",
          };
        })
        .sort((a, b) => {
          if (a.bsYear !== b.bsYear) return a.bsYear - b.bsYear;
          if (a.bsMonth !== b.bsMonth) return a.bsMonth - b.bsMonth;
          if (a.bsDay !== b.bsDay) return a.bsDay - b.bsDay;
          return a.caseNo.localeCompare(b.caseNo);
        });

      const openCases = cases.filter((legalCase) => legalCase.status !== "closed").length;

      res.json({
        summary: {
          total: rows.length + pesiRows.length,
          overdue,
          dueToday,
          dueThisWeek,
          upcoming,
          openCases,
        },
        activities: rows,
        pesiRows,
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

router.get(
  "/cases/:id/pesi",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      const rows = await CasePesiRow.find({ caseId: legalCase._id }).sort({
        pesiDate: -1,
        _id: -1,
      });

      res.json({
        columns: CASE_PESI_COLUMNS,
        courtScDailyId: legalCase.courtScDailyId ?? null,
        caseNo: legalCase.caseNo,
        rows: rows.map(casePesiRowToJson),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load pesi rows" });
    }
  }
);

router.post(
  "/cases/:id/pesi/fetch",
  requireSajiloKanunAuth,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }

      let courtScDailyId = legalCase.courtScDailyId;
      if (typeof courtScDailyId !== "number" && legalCase.courtId) {
        const { Court } = await import("../models/Court");
        const court = await Court.findById(legalCase.courtId).select("scDailyId");
        if (typeof court?.scDailyId === "number") {
          courtScDailyId = court.scDailyId;
          legalCase.courtScDailyId = court.scDailyId;
          await legalCase.save();
        }
      }
      if (typeof courtScDailyId !== "number") {
        res.status(400).json({
          error:
            "This case has no Supreme Court court id. Edit the case and select a district court first.",
        });
        return;
      }

      const result = await fetchAndMatchCasePesi({
        courtScDailyId,
        caseNo: legalCase.caseNo,
      });

      const fetchedAt = new Date(result.fetchedAt);
      const fetchedBy = new mongoose.Types.ObjectId(req.sajiloKanunUser!.id);
      const saved = [];

      for (const row of result.matchedRows) {
        const doc = await CasePesiRow.findOneAndUpdate(
          {
            caseId: legalCase._id,
            pesiDate: row.pesiDate,
            caseNoRaw: row.caseNoRaw,
          },
          {
            $set: {
              teamId: legalCase.teamId,
              courtScDailyId,
              pesiDate: row.pesiDate,
              sn: row.sn,
              caseNoRaw: row.caseNoRaw,
              registrationDate: row.registrationDate,
              matter: row.matter,
              parties: row.parties,
              fantawala: row.fantawala,
              signal: row.signal,
              priority: row.priority,
              remarks: row.remarks,
              cells: row.cells,
              fetchedAt,
              fetchedBy,
            },
          },
          { upsert: true, new: true }
        );
        saved.push(casePesiRowToJson(doc));
      }

      const allRows = await CasePesiRow.find({ caseId: legalCase._id }).sort({
        pesiDate: -1,
        _id: -1,
      });

      res.json({
        columns: CASE_PESI_COLUMNS,
        courtScDailyId,
        caseNo: legalCase.caseNo,
        totalRowsScanned: result.totalRows,
        matchedCount: saved.length,
        fetchedAt: result.fetchedAt,
        rows: allRows.map(casePesiRowToJson),
      });
    } catch (err) {
      console.error(err);
      res.status(502).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch Supreme Court pesi list",
      });
    }
  }
);

router.post(
  "/dashboard/pesi/fetch",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (user.role !== "admin") {
        res.status(403).json({ error: "Only firm admins can refresh court pesi" });
        return;
      }

      const teamId = user.teamId!;
      const cases = await LegalCase.find({
        teamId,
        status: { $ne: "closed" },
      })
        .select("_id caseNo courtId courtScDailyId")
        .lean();

      if (cases.length === 0) {
        res.json({
          casesProcessed: 0,
          casesSkipped: 0,
          matchedCount: 0,
          courtsFetched: 0,
          errors: [],
        });
        return;
      }

      const { Court } = await import("../models/Court");
      const missingCourtIds = [
        ...new Set(
          cases
            .filter((c) => typeof c.courtScDailyId !== "number" && c.courtId)
            .map((c) => c.courtId!.toString())
        ),
      ];
      const courtDocs =
        missingCourtIds.length > 0
          ? await Court.find({ _id: { $in: missingCourtIds } })
              .select("_id scDailyId")
              .lean()
          : [];
      const scDailyByCourtId = new Map(
        courtDocs
          .filter((c) => typeof c.scDailyId === "number")
          .map((c) => [c._id.toString(), c.scDailyId as number])
      );

      type CaseWithCourt = {
        _id: mongoose.Types.ObjectId;
        caseNo: string;
        courtScDailyId: number;
      };
      const eligible: CaseWithCourt[] = [];
      let casesSkipped = 0;
      for (const legalCase of cases) {
        let courtScDailyId =
          typeof legalCase.courtScDailyId === "number"
            ? legalCase.courtScDailyId
            : legalCase.courtId
              ? scDailyByCourtId.get(legalCase.courtId.toString())
              : undefined;
        if (typeof courtScDailyId !== "number") {
          casesSkipped += 1;
          continue;
        }
        eligible.push({
          _id: legalCase._id,
          caseNo: legalCase.caseNo,
          courtScDailyId,
        });
      }

      const byCourt = new Map<number, CaseWithCourt[]>();
      for (const item of eligible) {
        const list = byCourt.get(item.courtScDailyId) ?? [];
        list.push(item);
        byCourt.set(item.courtScDailyId, list);
      }

      const fetchedBy = new mongoose.Types.ObjectId(user.id);
      let matchedCount = 0;
      let courtsFetched = 0;
      const errors: { caseId: string; caseNo: string; error: string }[] = [];

      for (const [courtScDailyId, courtCases] of byCourt) {
        try {
          const { rows, fetchedAt } = await fetchCourtWeeklyPesiRows(courtScDailyId);
          courtsFetched += 1;
          const fetchedAtDate = new Date(fetchedAt);

          for (const legalCase of courtCases) {
            try {
              const matched = rows.filter((row) =>
                caseNoMatches(row.caseNoRaw, legalCase.caseNo)
              );
              for (const row of matched) {
                await CasePesiRow.findOneAndUpdate(
                  {
                    caseId: legalCase._id,
                    pesiDate: row.pesiDate,
                    caseNoRaw: row.caseNoRaw,
                  },
                  {
                    $set: {
                      teamId,
                      courtScDailyId,
                      pesiDate: row.pesiDate,
                      sn: row.sn,
                      caseNoRaw: row.caseNoRaw,
                      registrationDate: row.registrationDate,
                      matter: row.matter,
                      parties: row.parties,
                      fantawala: row.fantawala,
                      signal: row.signal,
                      priority: row.priority,
                      remarks: row.remarks,
                      cells: row.cells,
                      fetchedAt: fetchedAtDate,
                      fetchedBy,
                    },
                  },
                  { upsert: true, new: true }
                );
                matchedCount += 1;
              }
            } catch (err) {
              errors.push({
                caseId: legalCase._id.toString(),
                caseNo: legalCase.caseNo,
                error: err instanceof Error ? err.message : "Failed to save pesi",
              });
            }
          }
        } catch (err) {
          for (const legalCase of courtCases) {
            errors.push({
              caseId: legalCase._id.toString(),
              caseNo: legalCase.caseNo,
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to fetch court pesi list",
            });
          }
        }
      }

      res.json({
        casesProcessed: eligible.length,
        casesSkipped,
        matchedCount,
        courtsFetched,
        errors,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to refresh court pesi" });
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

      const teamId = legalCase.teamId?.toString();
      if (teamId) {
        const docQuota = await assertFirmCanGenerateDocument(teamId);
        if (!docQuota.allowed) {
          res.status(429).json({
            error: docQuota.error,
            code: docQuota.code,
            used: docQuota.used,
            limit: docQuota.limit,
            firmQuota: docQuota.quota,
          });
          return;
        }
      }

      const title = LEGAL_CASE_DOCUMENT_TITLES[kind];
      const now = new Date();
      const rawContent =
        typeof (req.body as { content?: unknown }).content === "string"
          ? (req.body as { content: string }).content.trim()
          : "";
      const hasGeneratedContent = rawContent.length > 0;
      if (rawContent.length > 50000) {
        res.status(400).json({ error: "Document content is too long" });
        return;
      }

      legalCase.documents.push({
        kind,
        title,
        status: hasGeneratedContent ? "ready" : "placeholder",
        content: hasGeneratedContent
          ? rawContent
          : `[Placeholder] ${title} for case ${legalCase.caseNo} (${legalCase.title}).\n` +
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

router.post(
  "/cases/:id/documents/:docId/save-to-files",
  requireSajiloKanunAuth,
  requireSkTeamMember,
  async (req: SajiloKanunAuthRequest, res) => {
    try {
      const user = req.sajiloKanunUser!;
      if (!(await canUploadCaseFiles(user))) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const caseId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const docId = Array.isArray(req.params.docId)
        ? req.params.docId[0]
        : req.params.docId;
      const legalCase = await findAccessibleCase(req, caseId);
      if (!legalCase) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      if (!legalCase.teamId) {
        res.status(400).json({ error: "Case is missing firm assignment" });
        return;
      }

      const draft = legalCase.documents.find(
        (item) => item._id.toString() === docId
      );
      if (!draft) {
        res.status(404).json({ error: "Generated document not found" });
        return;
      }
      if (draft.status !== "ready" || !draft.content?.trim()) {
        res.status(400).json({
          error: "Only a completed AI draft can be saved to case files",
        });
        return;
      }

      const buffer = await plaintextToDocxBuffer(draft.content);
      const saved = await saveCaseUploadBuffer({
        teamId: legalCase.teamId.toString(),
        caseId: legalCase._id.toString(),
        fileName: generatedDraftFileName(draft.title),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer,
      });

      const upload = await CaseUploadedDocument.create({
        caseId: legalCase._id,
        teamId: legalCase.teamId,
        uploadedBy: new mongoose.Types.ObjectId(user.id),
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        size: saved.size,
        storageKey: saved.storageKey,
      });

      draft.savedUploadId = upload._id;
      draft.updatedAt = new Date();
      await legalCase.save();

      res.json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error:
          err instanceof Error ? err.message : "Failed to save draft to case files",
      });
    }
  }
);

router.put(
  "/cases/:id/extraction",
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

      const body = req.body as {
        facts?: unknown;
        sourceFileNames?: unknown;
        model?: unknown;
      };
      if (!body.facts || typeof body.facts !== "object" || Array.isArray(body.facts)) {
        res.status(400).json({ error: "Extraction facts object is required" });
        return;
      }

      const serialized = JSON.stringify(body.facts);
      if (serialized.length > 200_000) {
        res.status(400).json({ error: "Extraction payload is too large" });
        return;
      }

      const sourceFileNames = Array.isArray(body.sourceFileNames)
        ? body.sourceFileNames
            .filter((name): name is string => typeof name === "string")
            .map((name) => name.trim())
            .filter(Boolean)
            .slice(0, 20)
        : legalCase.documentExtraction?.sourceFileNames ?? [];

      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim().slice(0, 120)
          : legalCase.documentExtraction?.model ?? "";

      const now = new Date();
      const createdAt = legalCase.documentExtraction?.createdAt ?? now;
      legalCase.documentExtraction = {
        facts: body.facts as Record<string, unknown>,
        sourceFileNames,
        model,
        updatedBy: new mongoose.Types.ObjectId(req.sajiloKanunUser!.id),
        createdAt,
        updatedAt: now,
      };

      await legalCase.save();
      res.json(legalCaseToJson(legalCase, { detail: true }));
    } catch (err) {
      console.error(err);
      res.status(400).json({
        error: err instanceof Error ? err.message : "Failed to save extraction",
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
