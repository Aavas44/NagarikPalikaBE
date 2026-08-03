import { Router } from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Team, teamToJson } from "../models/Team";
import { SajiloKanunAccount } from "../models/SajiloKanunAccount";
import { RolePolicy } from "../models/RolePolicy";
import { User, userToJson } from "../models/User";
import { CaseParticipant } from "../models/CaseParticipant";
import { LegalCase } from "../models/LegalCase";
import {
  requireAuth,
  requirePlatformPermission,
  requireSuperadmin,
  type AuthRequest,
} from "../middleware/auth";
import { createTeamAccount } from "../services/team-accounts";
import { enrichSajiloKanunAccounts } from "../services/sajilokanun-account-enrich";
import { getTeamUsageLog, getTeamUsageSummary } from "../services/sajilokanun-usage";
import {
  isRoleKey,
  listRolePolicies,
  ROLE_PERMISSION_CATALOG,
  sanitizeRolePermissions,
} from "../services/role-policies";
import type { SajiloKanunAccountRole, UserType } from "../types";

const router = Router();

router.use(requireAuth);

type DirectoryUserType =
  | "superadmin"
  | "admin"
  | "firm_admin"
  | "member"
  | "case_user";

function platformUserTypeLabel(userType: UserType): string {
  if (userType === "superadmin") return "Superadmin";
  if (userType === "admin") return "Admin";
  return userType;
}

function firmDirectoryUserType(
  role: SajiloKanunAccountRole | null | undefined
): DirectoryUserType {
  if (role === "admin") return "firm_admin";
  if (role === "caseUser") return "case_user";
  return "member";
}

router.get("/role-policies", requireSuperadmin, async (_req, res) => {
  try {
    res.json({
      roles: await listRolePolicies(),
      permissions: ROLE_PERMISSION_CATALOG,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load role policies" });
  }
});

router.patch(
  "/role-policies/:roleKey",
  requireSuperadmin,
  async (req: AuthRequest, res) => {
  try {
    const roleKey = Array.isArray(req.params.roleKey)
      ? req.params.roleKey[0]
      : req.params.roleKey;
    if (!isRoleKey(roleKey)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }

    const permissions = sanitizeRolePermissions(roleKey, req.body?.permissions);
    await RolePolicy.findOneAndUpdate(
      { roleKey },
      {
        $set: {
          permissions,
          updatedBy: new mongoose.Types.ObjectId(req.user!.id),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const roles = await listRolePolicies();
    res.json(roles.find((role) => role.key === roleKey));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update role policy" });
  }
  }
);

router.get(
  "/teams",
  requirePlatformPermission("platform.firms.manage"),
  async (req, res) => {
  try {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const filter =
      search.length > 0
        ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
        : {};
    const teams = await Team.find(filter).sort({ name: 1 }).limit(search ? 40 : 200);
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
  }
);

router.post(
  "/teams",
  requirePlatformPermission("platform.firms.manage"),
  async (req: AuthRequest, res) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "Firm name is required" });
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
    res.status(500).json({ error: "Failed to create firm" });
  }
  }
);

router.patch(
  "/teams/:id",
  requirePlatformPermission("platform.firms.manage"),
  async (req, res) => {
  try {
    const { name, active } = req.body as { name?: string; active?: boolean };
    const updates: Record<string, unknown> = {};
    if (name?.trim()) updates.name = name.trim();
    if (typeof active === "boolean") updates.active = active;

    const team = await Team.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!team) {
      res.status(404).json({ error: "Firm not found" });
      return;
    }
    res.json(teamToJson(team));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update firm" });
  }
  }
);

/** Unified directory: platform superadmins/admins + all Sajilo Kanun firm accounts. */
router.get(
  "/directory",
  requirePlatformPermission("platform.members.manage"),
  async (_req, res) => {
  try {
    const [platformUsers, firmAccounts] = await Promise.all([
      User.find({ userType: { $in: ["superadmin", "admin"] } }).sort({ createdAt: -1 }),
      SajiloKanunAccount.find().sort({ createdAt: -1 }),
    ]);

    const enrichedFirms = await enrichSajiloKanunAccounts(firmAccounts);

    const platformRows = platformUsers.map((user) => {
      const json = userToJson(user);
      return {
        id: json.id,
        kind: "platform" as const,
        name: json.name,
        email: json.email,
        contactNo: json.phone ?? "",
        username: json.email,
        active: true,
        teamId: null as string | null,
        firmName: null as string | null,
        role: null as SajiloKanunAccountRole | null,
        userType: platformUserTypeLabel(user.userType),
        directoryUserType: user.userType as DirectoryUserType,
        createdAt: json.createdAt ?? null,
        createdBy: null as string | null,
        createdByName: null as string | null,
      };
    });

    const firmRows = enrichedFirms.map((account) => ({
      id: account.id,
      kind: "firm" as const,
      name: account.name,
      email: account.email,
      contactNo: account.contactNo ?? "",
      username: account.username,
      active: account.active,
      teamId: account.teamId,
      firmName: account.firmName,
      role: account.role,
      userType: account.userType,
      directoryUserType: firmDirectoryUserType(account.role),
      createdAt: account.createdAt ?? null,
      createdBy: account.createdBy,
      createdByName: account.createdByName,
      assignedCases: [] as Array<{
        id: string;
        title: string;
        caseNo: string;
        status: string;
      }>,
    }));

    try {
      const caseUserIds = firmRows
        .filter((row) => row.role === "caseUser")
        .map((row) => row.id)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (caseUserIds.length > 0) {
        const participants = await CaseParticipant.find({
          accountId: { $in: caseUserIds },
          status: "active",
        }).select("accountId caseId");

        const caseIds = [
          ...new Set(participants.map((p) => p.caseId.toString())),
        ]
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));

        const cases = caseIds.length
          ? await LegalCase.find({ _id: { $in: caseIds } }).select(
              "title caseNo status"
            )
          : [];
        const caseById = new Map(
          cases.map((legalCase) => [
            legalCase._id.toString(),
            {
              id: legalCase._id.toString(),
              title: legalCase.title,
              caseNo: legalCase.caseNo,
              status: String(legalCase.status),
            },
          ])
        );

        const casesByAccount = new Map<
          string,
          Array<{ id: string; title: string; caseNo: string; status: string }>
        >();
        for (const participant of participants) {
          const accountId = participant.accountId.toString();
          const legalCase = caseById.get(participant.caseId.toString());
          if (!legalCase) continue;
          const list = casesByAccount.get(accountId) ?? [];
          if (!list.some((item) => item.id === legalCase.id)) {
            list.push(legalCase);
          }
          casesByAccount.set(accountId, list);
        }

        for (const row of firmRows) {
          if (row.role === "caseUser") {
            row.assignedCases = casesByAccount.get(row.id) ?? [];
          }
        }
      }
    } catch (caseLookupErr) {
      console.error("Failed to attach assigned cases to directory:", caseLookupErr);
    }

    const people = [...platformRows, ...firmRows].sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      return bTime - aTime;
    });

    res.json(people);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load members directory" });
  }
  }
);

router.post(
  "/directory",
  requirePlatformPermission("platform.members.manage"),
  async (req: AuthRequest, res) => {
  try {
    const {
      name,
      email,
      contactNo,
      username,
      password,
      userType,
      role,
      firmId,
    } = req.body as {
      name?: string;
      email?: string;
      contactNo?: string;
      username?: string;
      password?: string;
      userType?: DirectoryUserType;
      role?: SajiloKanunAccountRole | "superadmin" | "admin";
      firmId?: string;
    };

    if (!name?.trim() || !password) {
      res.status(400).json({ error: "Full name and password are required" });
      return;
    }

    const isPlatformAccount =
      userType === "superadmin" || userType === "admin";
    const assignedPlatformRole = isPlatformAccount ? userType : undefined;
    const assignedFirmRole: SajiloKanunAccountRole | undefined =
      userType === "firm_admin"
        ? "admin"
        : userType === "member"
          ? "member"
          : role === "member"
            ? "member"
            : role === "admin"
              ? "admin"
              : undefined;

    if (assignedPlatformRole) {
      const normalizedEmail = (email ?? username)?.trim().toLowerCase();
      if (!normalizedEmail) {
        res.status(400).json({ error: "Email is required for platform accounts" });
        return;
      }

      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        userType: assignedPlatformRole,
        authProvider: "local",
        passwordHash,
        phone: contactNo?.trim() || undefined,
      });

      const json = userToJson(user);
      res.status(201).json({
        id: json.id,
        kind: "platform",
        name: json.name,
        email: json.email,
        contactNo: json.phone ?? "",
        username: json.email,
        active: true,
        teamId: null,
        firmName: null,
        role: null,
        userType: platformUserTypeLabel(user.userType),
        directoryUserType: user.userType,
        createdAt: json.createdAt ?? null,
        createdBy: req.user!.id,
        createdByName: req.user!.name ?? null,
      });
      return;
    }

    if (!assignedFirmRole) {
      res.status(400).json({ error: "Invalid role to assign" });
      return;
    }

    if (!firmId?.trim()) {
      res.status(400).json({
        error: "Firm is required for firm admin and member accounts",
      });
      return;
    }

    if (!username?.trim()) {
      res.status(400).json({ error: "Username is required for firm accounts" });
      return;
    }

    const account = await createTeamAccount({
      teamId: firmId,
      username,
      password,
      name,
      email,
      contactNo,
      role: assignedFirmRole,
      createdBy: req.user!.id,
    });

    const [enriched] = await enrichSajiloKanunAccounts([account]);
    res.status(201).json({
      id: enriched.id,
      kind: "firm",
      name: enriched.name,
      email: enriched.email,
      contactNo: enriched.contactNo ?? "",
      username: enriched.username,
      active: enriched.active,
      teamId: enriched.teamId,
      firmName: enriched.firmName,
      role: enriched.role,
      userType: enriched.userType,
      directoryUserType: firmDirectoryUserType(assignedFirmRole),
      createdAt: enriched.createdAt ?? null,
      createdBy: enriched.createdBy,
      createdByName: enriched.createdByName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    const status = message.includes("already") ? 409 : 400;
    console.error(err);
    res.status(status).json({ error: message });
  }
  }
);

router.get(
  "/accounts",
  requirePlatformPermission("platform.members.manage"),
  async (req, res) => {
  try {
    const role = typeof req.query.role === "string" ? req.query.role : undefined;
    const filter: Record<string, unknown> = {};
    if (role === "admin" || role === "member") {
      filter.role = role;
    }

    const accounts = await SajiloKanunAccount.find(filter).sort({ createdAt: -1 });
    res.json(await enrichSajiloKanunAccounts(accounts));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list accounts" });
  }
  }
);

router.get(
  "/teams/:id/accounts",
  requirePlatformPermission("platform.members.manage"),
  async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      res.status(404).json({ error: "Firm not found" });
      return;
    }

    const accounts = await SajiloKanunAccount.find({ teamId: team._id }).sort({
      createdAt: -1,
    });
    res.json(await enrichSajiloKanunAccounts(accounts));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list accounts" });
  }
  }
);

router.post(
  "/teams/:id/accounts",
  requirePlatformPermission("platform.members.manage"),
  async (req: AuthRequest, res) => {
  try {
    const { username, password, name, email, contactNo, role } = req.body as {
      username?: string;
      password?: string;
      name?: string;
      email?: string;
      contactNo?: string;
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
      contactNo,
      role,
      createdBy: req.user!.id,
    });

    const [enriched] = await enrichSajiloKanunAccounts([account]);
    res.status(201).json(enriched);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create account";
    const status = message.includes("already taken") ? 409 : 400;
    console.error(err);
    res.status(status).json({ error: message });
  }
  }
);

router.patch(
  "/accounts/:id",
  requirePlatformPermission("platform.members.manage"),
  async (req, res) => {
  try {
    const existing = await SajiloKanunAccount.findById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const { active, role, password, teamId, contactNo, name, email, username } =
      req.body as {
        active?: boolean;
        role?: SajiloKanunAccountRole;
        password?: string;
        teamId?: string | null;
        contactNo?: string;
        name?: string;
        email?: string;
        username?: string;
      };

    const updates: Record<string, unknown> = {};
    if (typeof active === "boolean") updates.active = active;
    if (role === "admin" || role === "member") {
      if (existing.role === "caseUser") {
        res.status(400).json({
          error: "Case users cannot be converted to firm admin or firm member here",
        });
        return;
      }
      updates.role = role;
    }
    if (typeof password === "string" && password.trim()) {
      updates.passwordHash = await bcrypt.hash(password.trim(), 10);
    }
    if (typeof contactNo === "string") {
      updates.contactNo = contactNo.trim() || undefined;
    }
    if (typeof name === "string") {
      const nextName = name.trim();
      if (!nextName) {
        res.status(400).json({ error: "Name is required" });
        return;
      }
      updates.name = nextName.slice(0, 120);
    }
    if (typeof email === "string") {
      updates.email = email.trim().toLowerCase().slice(0, 200) || undefined;
    }
    if (typeof username === "string") {
      const nextUsername = username.trim().toLowerCase();
      if (!nextUsername) {
        res.status(400).json({ error: "Username is required" });
        return;
      }
      const clash = await SajiloKanunAccount.findOne({
        username: nextUsername,
        _id: { $ne: req.params.id },
      });
      if (clash) {
        res.status(400).json({ error: "Username is already taken" });
        return;
      }
      updates.username = nextUsername;
    }

    if (teamId !== undefined) {
      if (existing.role === "caseUser") {
        res.status(400).json({
          error: "Case user firm is set by their assigned case and cannot be changed",
        });
        return;
      }
      if (teamId === null || teamId === "") {
        res.status(400).json({ error: "Firm is required" });
        return;
      }
      if (!mongoose.Types.ObjectId.isValid(teamId)) {
        res.status(400).json({ error: "Invalid firm id" });
        return;
      }
      const team = await Team.findById(teamId);
      if (!team) {
        res.status(404).json({ error: "Firm not found" });
        return;
      }
      if (!team.active) {
        res.status(400).json({ error: "Cannot move member to an inactive firm" });
        return;
      }
      updates.teamId = team._id;
    }

    const account = await SajiloKanunAccount.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const [enriched] = await enrichSajiloKanunAccounts([account]);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update account" });
  }
  }
);

router.get(
  "/teams/:id/usage",
  requirePlatformPermission("platform.firms.manage"),
  async (req, res) => {
  try {
    const teamId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      res.status(400).json({ error: "Invalid firm id" });
      return;
    }

    const limit = Number(req.query.limit ?? 30);
    const offset = Number(req.query.offset ?? 0);
    const summary = await getTeamUsageSummary(teamId);
    const log = await getTeamUsageLog(teamId, { limit, offset });
    res.json({ usage: summary, ...log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load firm usage" });
  }
  }
);

export default router;
