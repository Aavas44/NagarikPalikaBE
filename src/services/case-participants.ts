import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  SajiloKanunAccount,
  type ISajiloKanunAccount,
} from "../models/SajiloKanunAccount";
import { CaseParticipant } from "../models/CaseParticipant";

/**
 * Create a Sajilo Kanun login for a case client (not a firm staff member).
 * Still scoped to the creating firm's teamId for directory / admin visibility.
 */
export async function createCaseClientAccount(params: {
  username: string;
  password: string;
  name: string;
  contactNo?: string;
  email?: string;
  createdBy: string;
  teamId: string;
}): Promise<ISajiloKanunAccount> {
  const username = params.username.trim().toLowerCase();
  if (!username || username.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (!params.password || params.password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  if (!params.name?.trim()) {
    throw new Error("Name is required");
  }
  if (!params.teamId?.trim() || !mongoose.Types.ObjectId.isValid(params.teamId)) {
    throw new Error("Firm is required for case users");
  }

  const existing = await SajiloKanunAccount.findOne({ username });
  if (existing) {
    throw new Error("Username already taken");
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  return SajiloKanunAccount.create({
    username,
    passwordHash,
    name: params.name.trim(),
    contactNo: params.contactNo?.trim() || undefined,
    email: params.email?.trim().toLowerCase() || undefined,
    active: true,
    role: "caseUser",
    teamId: new mongoose.Types.ObjectId(params.teamId),
    createdBy: new mongoose.Types.ObjectId(params.createdBy),
  });
}

export async function listActiveCaseIdsForAccount(accountId: string): Promise<string[]> {
  if (!mongoose.Types.ObjectId.isValid(accountId)) return [];
  const rows = await CaseParticipant.find({
    accountId: new mongoose.Types.ObjectId(accountId),
    status: "active",
  }).select("caseId");
  return rows.map((row) => row.caseId.toString());
}

export async function isActiveCaseParticipant(
  caseId: string,
  accountId: string
): Promise<boolean> {
  if (
    !mongoose.Types.ObjectId.isValid(caseId) ||
    !mongoose.Types.ObjectId.isValid(accountId)
  ) {
    return false;
  }
  const row = await CaseParticipant.findOne({
    caseId,
    accountId,
    status: "active",
  }).select("_id");
  return Boolean(row);
}
