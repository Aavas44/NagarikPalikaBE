import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Team } from "../models/Team";
import {
  SajiloKanunAccount,
  sajiloKanunAccountToJson,
  type ISajiloKanunAccount,
} from "../models/SajiloKanunAccount";
import type { SajiloKanunAccountRole } from "../types";

export async function assertTeamActive(teamId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(teamId)) return false;
  const team = await Team.findById(teamId);
  return Boolean(team?.active);
}

export async function createTeamAccount(params: {
  teamId: string;
  username: string;
  password: string;
  name: string;
  email?: string;
  role: SajiloKanunAccountRole;
  createdBy?: string;
}): Promise<ISajiloKanunAccount> {
  const team = await Team.findById(params.teamId);
  if (!team?.active) {
    throw new Error("Team not found or inactive");
  }

  const username = params.username.trim().toLowerCase();
  const existing = await SajiloKanunAccount.findOne({ username });
  if (existing) {
    throw new Error("Username already taken");
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const account = await SajiloKanunAccount.create({
    username,
    passwordHash,
    name: params.name.trim(),
    email: params.email?.trim().toLowerCase(),
    active: true,
    teamId: team._id,
    role: params.role,
    createdBy: params.createdBy
      ? new mongoose.Types.ObjectId(params.createdBy)
      : undefined,
  });

  return account;
}

export function accountToAuthUser(account: ISajiloKanunAccount) {
  return {
    id: account._id.toString(),
    username: account.username,
    name: account.name,
    teamId: account.teamId?.toString() ?? null,
    role: account.role ?? null,
  };
}

export { sajiloKanunAccountToJson };
