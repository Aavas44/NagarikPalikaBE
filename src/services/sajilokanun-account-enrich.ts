import mongoose from "mongoose";
import { Team, teamToJson } from "../models/Team";
import {
  SajiloKanunAccount,
  sajiloKanunAccountToJson,
  type ISajiloKanunAccount,
} from "../models/SajiloKanunAccount";
import { User } from "../models/User";

export type EnrichedSajiloKanunAccount = ReturnType<typeof sajiloKanunAccountToJson> & {
  firmName: string | null;
  createdByName: string | null;
};

async function resolveCreatorNames(
  creatorIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(creatorIds.filter(Boolean))];
  if (unique.length === 0) return names;

  const objectIds = unique
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const [users, accounts] = await Promise.all([
    User.find({ _id: { $in: objectIds } }).select("name"),
    SajiloKanunAccount.find({ _id: { $in: objectIds } }).select("name"),
  ]);

  for (const user of users) {
    names.set(user._id.toString(), user.name);
  }
  for (const account of accounts) {
    if (!names.has(account._id.toString())) {
      names.set(account._id.toString(), account.name);
    }
  }
  return names;
}

export async function enrichSajiloKanunAccounts(
  accounts: ISajiloKanunAccount[]
): Promise<EnrichedSajiloKanunAccount[]> {
  const teamIds = [
    ...new Set(
      accounts
        .map((a) => a.teamId?.toString())
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const creatorIds = accounts
    .map((a) => a.createdBy?.toString())
    .filter((id): id is string => Boolean(id));

  const [teams, creatorNames] = await Promise.all([
    Team.find({
      _id: {
        $in: teamIds
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id)),
      },
    }),
    resolveCreatorNames(creatorIds),
  ]);

  const firmById = new Map(teams.map((t) => [t._id.toString(), teamToJson(t).name]));

  return accounts.map((account) => {
    const base = sajiloKanunAccountToJson(account);
    const teamId = account.teamId?.toString() ?? null;
    const createdBy = account.createdBy?.toString() ?? null;
    return {
      ...base,
      firmName: teamId ? firmById.get(teamId) ?? null : null,
      createdByName: createdBy ? creatorNames.get(createdBy) ?? null : null,
    };
  });
}
