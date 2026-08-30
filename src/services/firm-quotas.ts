import mongoose from "mongoose";
import { LegalCase } from "../models/LegalCase";
import { Team } from "../models/Team";
import { TeamAiQueryReservation } from "../models/TeamAiQueryReservation";

export type FirmQuotaBucket = {
  limit: number | null;
  used: number;
  remaining: number | null;
};

export type FirmQuotaSnapshot = {
  plan: "firm";
  aiRequests: FirmQuotaBucket;
  cases: FirmQuotaBucket;
  documents: FirmQuotaBucket;
};

function bucket(limit: number | null | undefined, used: number): FirmQuotaBucket {
  const safeUsed = Math.max(0, used);
  if (limit == null) {
    return { limit: null, used: safeUsed, remaining: null };
  }
  return {
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
  };
}

export async function countTeamCases(teamId: string): Promise<number> {
  return LegalCase.countDocuments({
    teamId: new mongoose.Types.ObjectId(teamId),
  });
}

export async function countTeamGeneratedDocuments(teamId: string): Promise<number> {
  const rows = await LegalCase.aggregate<{ total: number }>([
    { $match: { teamId: new mongoose.Types.ObjectId(teamId) } },
    {
      $project: {
        docCount: { $size: { $ifNull: ["$documents", []] } },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$docCount" },
      },
    },
  ]);
  return rows[0]?.total ?? 0;
}

export async function getFirmQuotaSnapshot(teamId: string): Promise<FirmQuotaSnapshot> {
  const team = await Team.findById(teamId)
    .select("aiRequestsLimit casesLimit documentsLimit aiRequestsUsed")
    .lean();
  if (!team) {
    throw new Error("Firm not found");
  }

  const [casesUsed, documentsUsed] = await Promise.all([
    countTeamCases(teamId),
    countTeamGeneratedDocuments(teamId),
  ]);

  return {
    plan: "firm",
    aiRequests: bucket(team.aiRequestsLimit ?? null, team.aiRequestsUsed ?? 0),
    cases: bucket(team.casesLimit ?? null, casesUsed),
    documents: bucket(team.documentsLimit ?? null, documentsUsed),
  };
}

export async function reserveFirmAiQuery(
  teamId: string,
  questionId: string,
  questionHash: string
) {
  const normalizedQuestionId = questionId.trim().slice(0, 100);
  const normalizedQuestionHash = questionHash.trim().toLowerCase();
  if (
    !normalizedQuestionId ||
    !/^[a-f0-9]{64}$/.test(normalizedQuestionHash)
  ) {
    return {
      allowed: false as const,
      reason: "question_identity_required" as const,
      ...(await getFirmQuotaSnapshot(teamId)).aiRequests,
      questionId: null as string | null,
    };
  }

  const teamObjectId = new mongoose.Types.ObjectId(teamId);
  const existing = await TeamAiQueryReservation.findOne({
    teamId: teamObjectId,
    questionId: normalizedQuestionId,
  }).lean();

  if (existing) {
    const sameQuestion = existing.questionHash === normalizedQuestionHash;
    const snapshot = await getFirmQuotaSnapshot(teamId);
    return {
      allowed: sameQuestion,
      reason: sameQuestion ? undefined : ("different_question" as const),
      ...snapshot.aiRequests,
      questionId: existing.questionId,
    };
  }

  const team = await Team.findById(teamId).select(
    "aiRequestsLimit aiRequestsUsed"
  );
  if (!team) {
    throw new Error("Firm not found");
  }

  const limit = team.aiRequestsLimit ?? null;
  const used = team.aiRequestsUsed ?? 0;
  if (limit != null && used >= limit) {
    return {
      allowed: false as const,
      reason: "firm_ai_limit_reached" as const,
      limit,
      used,
      remaining: 0,
      questionId: null,
    };
  }

  try {
    await TeamAiQueryReservation.create({
      teamId: teamObjectId,
      questionId: normalizedQuestionId,
      questionHash: normalizedQuestionHash,
    });
  } catch (err) {
    const duplicate =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === 11000;
    if (!duplicate) throw err;

    const raced = await TeamAiQueryReservation.findOne({
      teamId: teamObjectId,
      questionId: normalizedQuestionId,
    }).lean();
    const sameQuestion = raced?.questionHash === normalizedQuestionHash;
    const snapshot = await getFirmQuotaSnapshot(teamId);
    return {
      allowed: sameQuestion,
      reason: sameQuestion ? undefined : ("different_question" as const),
      ...snapshot.aiRequests,
      questionId: raced?.questionId ?? null,
    };
  }

  const updated = await Team.findOneAndUpdate(
    {
      _id: teamObjectId,
      $or: [
        { aiRequestsLimit: null },
        { aiRequestsLimit: { $exists: false } },
        {
          $expr: {
            $lt: [{ $ifNull: ["$aiRequestsUsed", 0] }, "$aiRequestsLimit"],
          },
        },
      ],
    },
    { $inc: { aiRequestsUsed: 1 } },
    { new: true }
  ).select("aiRequestsLimit aiRequestsUsed");

  if (!updated) {
    await TeamAiQueryReservation.deleteOne({
      teamId: teamObjectId,
      questionId: normalizedQuestionId,
    });
    const snapshot = await getFirmQuotaSnapshot(teamId);
    return {
      allowed: false as const,
      reason: "firm_ai_limit_reached" as const,
      ...snapshot.aiRequests,
      questionId: null,
    };
  }

  return {
    allowed: true as const,
    ...bucket(updated.aiRequestsLimit ?? null, updated.aiRequestsUsed ?? 0),
    questionId: normalizedQuestionId,
  };
}

export async function assertFirmCanCreateCase(teamId: string) {
  const snapshot = await getFirmQuotaSnapshot(teamId);
  const { limit, used, remaining } = snapshot.cases;
  if (limit != null && remaining !== null && remaining <= 0) {
    return {
      allowed: false as const,
      code: "firm_case_quota" as const,
      error: `This firm has reached its case limit (${used}/${limit}).`,
      used,
      limit,
      quota: snapshot,
    };
  }
  return { allowed: true as const, quota: snapshot };
}

export async function assertFirmCanGenerateDocument(teamId: string) {
  const snapshot = await getFirmQuotaSnapshot(teamId);
  const { limit, used, remaining } = snapshot.documents;
  if (limit != null && remaining !== null && remaining <= 0) {
    return {
      allowed: false as const,
      code: "firm_documents_quota" as const,
      error: `This firm has reached its document generation limit (${used}/${limit}).`,
      used,
      limit,
      quota: snapshot,
    };
  }
  return { allowed: true as const, quota: snapshot };
}
