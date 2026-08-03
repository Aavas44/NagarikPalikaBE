import mongoose from "mongoose";
import { Team, teamToJson } from "../models/Team";
import {
  SajiloKanunAccount,
  sajiloKanunAccountToJson,
  type ISajiloKanunAccount,
} from "../models/SajiloKanunAccount";
import { CaseParticipant } from "../models/CaseParticipant";
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

/**
 * Resolve firm for case users missing teamId (legacy rows):
 * 1) active CaseParticipant.teamId
 * 2) creator account's teamId
 * Persists the resolved teamId so admin directory stays correct.
 */
async function backfillCaseUserTeamIds(
  accounts: ISajiloKanunAccount[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const needing = accounts.filter(
    (account) =>
      account.role === "caseUser" &&
      !account.teamId &&
      mongoose.Types.ObjectId.isValid(account._id)
  );
  if (needing.length === 0) return resolved;

  const accountIds = needing.map((account) => account._id);
  const creatorIds = [
    ...new Set(
      needing
        .map((account) => account.createdBy?.toString())
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [participants, creators] = await Promise.all([
    CaseParticipant.find({
      accountId: { $in: accountIds },
      status: "active",
    })
      .select("accountId teamId")
      .sort({ createdAt: -1 }),
    creatorIds.length
      ? SajiloKanunAccount.find({
          _id: {
            $in: creatorIds
              .filter((id) => mongoose.Types.ObjectId.isValid(id))
              .map((id) => new mongoose.Types.ObjectId(id)),
          },
        }).select("_id teamId")
      : Promise.resolve([]),
  ]);

  const teamFromParticipant = new Map<string, string>();
  for (const row of participants) {
    const accountId = row.accountId.toString();
    if (!teamFromParticipant.has(accountId) && row.teamId) {
      teamFromParticipant.set(accountId, row.teamId.toString());
    }
  }

  const teamFromCreator = new Map<string, string>();
  for (const creator of creators) {
    if (creator.teamId) {
      teamFromCreator.set(creator._id.toString(), creator.teamId.toString());
    }
  }

  const writes: Promise<unknown>[] = [];
  for (const account of needing) {
    const accountId = account._id.toString();
    const teamId =
      teamFromParticipant.get(accountId) ??
      (account.createdBy
        ? teamFromCreator.get(account.createdBy.toString())
        : undefined);
    if (!teamId || !mongoose.Types.ObjectId.isValid(teamId)) continue;

    resolved.set(accountId, teamId);
    account.teamId = new mongoose.Types.ObjectId(teamId);
    writes.push(
      SajiloKanunAccount.updateOne(
        { _id: account._id, $or: [{ teamId: null }, { teamId: { $exists: false } }] },
        { $set: { teamId: account.teamId } }
      )
    );
  }

  if (writes.length) {
    await Promise.all(writes);
  }

  return resolved;
}

export async function enrichSajiloKanunAccounts(
  accounts: ISajiloKanunAccount[]
): Promise<EnrichedSajiloKanunAccount[]> {
  await backfillCaseUserTeamIds(accounts);

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
      teamId,
      firmName: teamId ? firmById.get(teamId) ?? null : null,
      createdByName: createdBy ? creatorNames.get(createdBy) ?? null : null,
    };
  });
}
