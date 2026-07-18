import mongoose from "mongoose";
import { SajiloKanunDailyQuery } from "../models/SajiloKanunDailyQuery";

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

function nepalDay(now = new Date()) {
  const shifted = new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
  const dayKey = shifted.toISOString().slice(0, 10);
  const nextLocalMidnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1
  );
  const resetAt = new Date(
    nextLocalMidnightAsUtc - NEPAL_OFFSET_MINUTES * 60_000
  );
  return { dayKey, resetAt };
}

export async function getIndividualDailyQuota(userId: string) {
  const { dayKey, resetAt } = nepalDay();
  const reservation = await SajiloKanunDailyQuery.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    dayKey,
  }).lean();

  return {
    limit: 1,
    used: reservation ? 1 : 0,
    remaining: reservation ? 0 : 1,
    resetAt: resetAt.toISOString(),
    questionId: reservation?.questionId ?? null,
  };
}

export async function reserveIndividualDailyQuery(
  userId: string,
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
      ...(await getIndividualDailyQuota(userId)),
    };
  }

  const { dayKey, resetAt } = nepalDay();
  const objectId = new mongoose.Types.ObjectId(userId);

  try {
    await SajiloKanunDailyQuery.create({
      userId: objectId,
      dayKey,
      questionId: normalizedQuestionId,
      questionHash: normalizedQuestionHash,
    });
    return {
      allowed: true as const,
      limit: 1,
      used: 1,
      remaining: 0,
      resetAt: resetAt.toISOString(),
      questionId: normalizedQuestionId,
    };
  } catch (err) {
    const duplicate =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === 11000;
    if (!duplicate) throw err;

    const existing = await SajiloKanunDailyQuery.findOne({
      userId: objectId,
      dayKey,
    }).lean();
    const sameQuestion =
      existing?.questionId === normalizedQuestionId &&
      existing?.questionHash === normalizedQuestionHash;
    return {
      allowed: sameQuestion,
      reason: sameQuestion ? undefined : ("daily_limit_reached" as const),
      limit: 1,
      used: 1,
      remaining: 0,
      resetAt: resetAt.toISOString(),
      questionId: existing?.questionId ?? null,
    };
  }
}
