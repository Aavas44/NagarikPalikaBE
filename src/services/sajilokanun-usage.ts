import mongoose from "mongoose";
import {
  SAJILO_KANUN_USAGE_OPERATIONS,
  SajiloKanunTokenUsage,
  type SajiloKanunUsageOperation,
} from "../models/SajiloKanunTokenUsage";
import { SajiloKanunAccount } from "../models/SajiloKanunAccount";

/** Cached prompt tokens billed at ~50% of input (OpenAI gpt-4.1/5, Gemini context cache). */
export const PROMPT_CACHE_BILLING_FACTOR = 0.5;

export function estimateBillableTokens(params: {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}): number {
  const cached = Math.min(Math.max(0, params.cachedTokens ?? 0), params.promptTokens);
  const uncachedPrompt = params.promptTokens - cached;
  return (
    uncachedPrompt +
    Math.round(cached * PROMPT_CACHE_BILLING_FACTOR) +
    params.completionTokens
  );
}

export type UsageRecordInput = {
  operation: SajiloKanunUsageOperation;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
};

export type UsageRequestMeta = {
  requestId: string;
  requestType: "normalize" | "chat";
  label?: string;
};

export type UsageProcessLog = {
  id: string;
  operation: SajiloKanunUsageOperation;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  billableTokens: number;
  createdAt: string;
};

export type UsageRequestLog = {
  requestId: string;
  requestType: "normalize" | "chat";
  label: string;
  createdAt: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  billableTokens: number;
  processCount: number;
  processes: UsageProcessLog[];
};

export type UsageLogResponse = {
  summary: UsageSummary;
  requests: UsageRequestLog[];
  hasMore: boolean;
};

export type UsageSummary = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  /** Cache-adjusted estimate (cached prompt at 50% weight). */
  billableTokens: number;
  /** Distinct normalize/chat requests (grouped by requestId). */
  userRequestCount: number;
  /** Individual LLM operations recorded (rows in usage log). */
  operationCount: number;
  /** @deprecated Use operationCount — kept for older clients. */
  requestCount: number;
  byOperation: Record<
    SajiloKanunUsageOperation,
    { totalTokens: number; operationCount: number; requestCount: number }
  >;
  byMember?: Array<{
    userId: string;
    name: string;
    username: string;
    totalTokens: number;
    billableTokens: number;
    operationCount: number;
  }>;
};

function emptyByOperation(): UsageSummary["byOperation"] {
  const zero = { totalTokens: 0, operationCount: 0, requestCount: 0 };
  return {
    normalize: { ...zero },
    normalize_route: { ...zero },
    normalize_dafa: { ...zero },
    embedding: { ...zero },
    analysis: { ...zero },
    chat: { ...zero },
    narrative: { ...zero },
  };
}

function toProcessLog(process: {
  id: mongoose.Types.ObjectId;
  operation: SajiloKanunUsageOperation;
  provider: string;
  llmModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  createdAt: Date;
}): UsageProcessLog {
  const cachedTokens = process.cachedTokens ?? 0;
  return {
    id: process.id.toString(),
    operation: process.operation,
    provider: process.provider,
    model: process.llmModel,
    promptTokens: process.promptTokens,
    completionTokens: process.completionTokens,
    totalTokens: process.totalTokens,
    cachedTokens,
    billableTokens: estimateBillableTokens({
      promptTokens: process.promptTokens,
      completionTokens: process.completionTokens,
      cachedTokens,
    }),
    createdAt: process.createdAt.toISOString(),
  };
}

function isValidOperation(value: string): value is SajiloKanunUsageOperation {
  return SAJILO_KANUN_USAGE_OPERATIONS.includes(value as SajiloKanunUsageOperation);
}

export function sanitizeUsageEntries(entries: unknown): UsageRecordInput[] {
  if (!Array.isArray(entries)) return [];

  const out: UsageRecordInput[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const entry = item as UsageRecordInput;
    const operation = String(entry.operation ?? "").trim();
    const provider = String(entry.provider ?? "").trim();
    const model = String(entry.model ?? "").trim();
    if (!isValidOperation(operation) || !provider || !model) continue;

    const promptTokens = Math.max(0, Number(entry.promptTokens ?? 0) || 0);
    const completionTokens = Math.max(0, Number(entry.completionTokens ?? 0) || 0);
    const totalTokens = Math.max(
      0,
      Number(entry.totalTokens ?? promptTokens + completionTokens) || 0
    );
    const cachedTokens = Math.max(0, Number(entry.cachedTokens ?? 0) || 0);
    if (totalTokens <= 0) continue;

    out.push({
      operation,
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens,
    });
  }

  return out;
}

export async function recordSajiloKanunUsage(
  userId: string,
  entries: UsageRecordInput[],
  request?: UsageRequestMeta
): Promise<UsageSummary> {
  if (entries.length === 0) {
    return getSajiloKanunUsageSummary(userId);
  }

  const objectId = new mongoose.Types.ObjectId(userId);
  const account = await SajiloKanunAccount.findById(userId).select("teamId");
  const teamId = account?.teamId;

  if (!teamId) {
    console.warn(`[Sajilo Kanun usage] Account ${userId} has no teamId; recording without team scope`);
  }

  const label = request?.label?.trim().slice(0, 200);

  await SajiloKanunTokenUsage.insertMany(
    entries.map((entry) => ({
      userId: objectId,
      teamId: teamId ?? undefined,
      requestId: request?.requestId,
      requestType: request?.requestType,
      requestLabel: label,
      operation: entry.operation,
      provider: entry.provider,
      llmModel: entry.model,
      promptTokens: entry.promptTokens ?? 0,
      completionTokens: entry.completionTokens ?? 0,
      totalTokens: entry.totalTokens ?? 0,
      cachedTokens: entry.cachedTokens ?? 0,
    }))
  );

  return getSajiloKanunUsageSummary(userId);
}

const OPERATION_ORDER: Record<SajiloKanunUsageOperation, number> = {
  normalize: 0,
  normalize_route: 1,
  normalize_dafa: 2,
  embedding: 3,
  analysis: 4,
  narrative: 5,
  chat: 6,
};

export async function getSajiloKanunUsageLog(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<UsageLogResponse> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const objectId = new mongoose.Types.ObjectId(userId);

  const grouped = await SajiloKanunTokenUsage.aggregate<{
    _id: string;
    requestType: "normalize" | "chat";
    requestLabel?: string;
    createdAt: Date;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    processCount: number;
    processes: Array<{
      id: mongoose.Types.ObjectId;
      operation: SajiloKanunUsageOperation;
      provider: string;
      llmModel: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedTokens: number;
      createdAt: Date;
    }>;
  }>([
    { $match: { userId: objectId, requestId: { $exists: true, $ne: null } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$requestId",
        requestType: { $first: "$requestType" },
        requestLabel: { $first: "$requestLabel" },
        createdAt: { $max: "$createdAt" },
        totalTokens: { $sum: "$totalTokens" },
        promptTokens: { $sum: "$promptTokens" },
        completionTokens: { $sum: "$completionTokens" },
        cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
        processCount: { $sum: 1 },
        processes: {
          $push: {
            id: "$_id",
            operation: "$operation",
            provider: "$provider",
            llmModel: "$llmModel",
            promptTokens: "$promptTokens",
            completionTokens: "$completionTokens",
            totalTokens: "$totalTokens",
            cachedTokens: { $ifNull: ["$cachedTokens", 0] },
            createdAt: "$createdAt",
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: offset },
    { $limit: limit + 1 },
  ]);

  const hasMore = grouped.length > limit;
  const page = hasMore ? grouped.slice(0, limit) : grouped;

  const requests: UsageRequestLog[] = page.map((row) => {
    const cachedTokens = row.cachedTokens ?? 0;
    const processes = row.processes
      .sort(
        (a, b) =>
          (OPERATION_ORDER[a.operation] ?? 99) - (OPERATION_ORDER[b.operation] ?? 99)
      )
      .map((process) => toProcessLog(process));

    return {
      requestId: row._id,
      requestType: row.requestType ?? "chat",
      label:
        row.requestLabel?.trim() ||
        (row.requestType === "normalize" ? "Query normalize" : "Chat request"),
      createdAt: row.createdAt.toISOString(),
      totalTokens: row.totalTokens,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cachedTokens,
      billableTokens: estimateBillableTokens({
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cachedTokens,
      }),
      processCount: row.processCount,
      processes,
    };
  });

  const summary = await getSajiloKanunUsageSummary(userId);
  return { summary, requests, hasMore };
}

export async function getSajiloKanunUsageSummary(userId: string): Promise<UsageSummary> {
  const objectId = new mongoose.Types.ObjectId(userId);
  const [totals, byOperationRows, userRequestCount] = await Promise.all([
    SajiloKanunTokenUsage.aggregate<{
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      cachedTokens: number;
      operationCount: number;
    }>([
      { $match: { userId: objectId } },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: "$totalTokens" },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
          operationCount: { $sum: 1 },
        },
      },
    ]),
    SajiloKanunTokenUsage.aggregate<{
      _id: SajiloKanunUsageOperation;
      totalTokens: number;
      operationCount: number;
    }>([
      { $match: { userId: objectId } },
      {
        $group: {
          _id: "$operation",
          totalTokens: { $sum: "$totalTokens" },
          operationCount: { $sum: 1 },
        },
      },
    ]),
    SajiloKanunTokenUsage.distinct("requestId", {
      userId: objectId,
      requestId: { $exists: true, $ne: null },
    }),
  ]);

  const byOperation = emptyByOperation();
  for (const row of byOperationRows) {
    if (!isValidOperation(row._id)) continue;
    byOperation[row._id] = {
      totalTokens: row.totalTokens,
      operationCount: row.operationCount,
      requestCount: row.operationCount,
    };
  }

  const total = totals[0];
  const promptTokens = total?.promptTokens ?? 0;
  const completionTokens = total?.completionTokens ?? 0;
  const cachedTokens = total?.cachedTokens ?? 0;
  const operationCount = total?.operationCount ?? 0;
  const billableTokens = estimateBillableTokens({
    promptTokens,
    completionTokens,
    cachedTokens,
  });

  return {
    totalTokens: total?.totalTokens ?? 0,
    promptTokens,
    completionTokens,
    cachedTokens,
    billableTokens,
    userRequestCount: userRequestCount.length,
    operationCount,
    requestCount: operationCount,
    byOperation,
  };
}

async function buildUsageSummaryFromMatch(
  match: Record<string, unknown>
): Promise<UsageSummary> {
  const [totals, byOperationRows, userRequestCount] = await Promise.all([
    SajiloKanunTokenUsage.aggregate<{
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      cachedTokens: number;
      operationCount: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: "$totalTokens" },
          promptTokens: { $sum: "$promptTokens" },
          completionTokens: { $sum: "$completionTokens" },
          cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
          operationCount: { $sum: 1 },
        },
      },
    ]),
    SajiloKanunTokenUsage.aggregate<{
      _id: SajiloKanunUsageOperation;
      totalTokens: number;
      operationCount: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: "$operation",
          totalTokens: { $sum: "$totalTokens" },
          operationCount: { $sum: 1 },
        },
      },
    ]),
    SajiloKanunTokenUsage.distinct("requestId", {
      ...match,
      requestId: { $exists: true, $ne: null },
    }),
  ]);

  const byOperation = emptyByOperation();
  for (const row of byOperationRows) {
    if (!isValidOperation(row._id)) continue;
    byOperation[row._id] = {
      totalTokens: row.totalTokens,
      operationCount: row.operationCount,
      requestCount: row.operationCount,
    };
  }

  const total = totals[0];
  const promptTokens = total?.promptTokens ?? 0;
  const completionTokens = total?.completionTokens ?? 0;
  const cachedTokens = total?.cachedTokens ?? 0;
  const operationCount = total?.operationCount ?? 0;
  const billableTokens = estimateBillableTokens({
    promptTokens,
    completionTokens,
    cachedTokens,
  });

  return {
    totalTokens: total?.totalTokens ?? 0,
    promptTokens,
    completionTokens,
    cachedTokens,
    billableTokens,
    userRequestCount: userRequestCount.length,
    operationCount,
    requestCount: operationCount,
    byOperation,
  };
}

export async function getTeamUsageSummary(teamId: string): Promise<UsageSummary> {
  const teamObjectId = new mongoose.Types.ObjectId(teamId);
  const summary = await buildUsageSummaryFromMatch({ teamId: teamObjectId });

  const memberRows = await SajiloKanunTokenUsage.aggregate<{
    _id: mongoose.Types.ObjectId;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    operationCount: number;
  }>([
    { $match: { teamId: teamObjectId } },
    {
      $group: {
        _id: "$userId",
        totalTokens: { $sum: "$totalTokens" },
        promptTokens: { $sum: "$promptTokens" },
        completionTokens: { $sum: "$completionTokens" },
        cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
        operationCount: { $sum: 1 },
      },
    },
    { $sort: { totalTokens: -1 } },
  ]);

  const memberIds = memberRows.map((r) => r._id);
  const accounts = await SajiloKanunAccount.find({ _id: { $in: memberIds } }).select(
    "name username"
  );
  const accountMap = new Map(accounts.map((a) => [a._id.toString(), a]));

  summary.byMember = memberRows.map((row) => {
    const account = accountMap.get(row._id.toString());
    const cached = row.cachedTokens ?? 0;
    return {
      userId: row._id.toString(),
      name: account?.name ?? "Unknown",
      username: account?.username ?? "",
      totalTokens: row.totalTokens,
      billableTokens: estimateBillableTokens({
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cachedTokens: cached,
      }),
      operationCount: row.operationCount,
    };
  });

  return summary;
}

export async function getTeamUsageLog(
  teamId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<UsageLogResponse> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const teamObjectId = new mongoose.Types.ObjectId(teamId);

  const grouped = await SajiloKanunTokenUsage.aggregate<{
    _id: string;
    requestType: "normalize" | "chat";
    requestLabel?: string;
    createdAt: Date;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    processCount: number;
    userId: mongoose.Types.ObjectId;
    processes: Array<{
      id: mongoose.Types.ObjectId;
      operation: SajiloKanunUsageOperation;
      provider: string;
      llmModel: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedTokens: number;
      createdAt: Date;
    }>;
  }>([
    { $match: { teamId: teamObjectId, requestId: { $exists: true, $ne: null } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$requestId",
        requestType: { $first: "$requestType" },
        requestLabel: { $first: "$requestLabel" },
        createdAt: { $max: "$createdAt" },
        userId: { $first: "$userId" },
        totalTokens: { $sum: "$totalTokens" },
        promptTokens: { $sum: "$promptTokens" },
        completionTokens: { $sum: "$completionTokens" },
        cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
        processCount: { $sum: 1 },
        processes: {
          $push: {
            id: "$_id",
            operation: "$operation",
            provider: "$provider",
            llmModel: "$llmModel",
            promptTokens: "$promptTokens",
            completionTokens: "$completionTokens",
            totalTokens: "$totalTokens",
            cachedTokens: { $ifNull: ["$cachedTokens", 0] },
            createdAt: "$createdAt",
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: offset },
    { $limit: limit + 1 },
  ]);

  const hasMore = grouped.length > limit;
  const page = hasMore ? grouped.slice(0, limit) : grouped;

  const requests: UsageRequestLog[] = page.map((row) => {
    const cachedTokens = row.cachedTokens ?? 0;
    const processes = row.processes
      .sort(
        (a, b) =>
          (OPERATION_ORDER[a.operation] ?? 99) - (OPERATION_ORDER[b.operation] ?? 99)
      )
      .map((process) => toProcessLog(process));

    return {
      requestId: row._id,
      requestType: row.requestType ?? "chat",
      label:
        row.requestLabel?.trim() ||
        (row.requestType === "normalize" ? "Query normalize" : "Chat request"),
      createdAt: row.createdAt.toISOString(),
      totalTokens: row.totalTokens,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      cachedTokens,
      billableTokens: estimateBillableTokens({
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cachedTokens,
      }),
      processCount: row.processCount,
      processes,
    };
  });

  const summary = await getTeamUsageSummary(teamId);
  return { summary, requests, hasMore };
}

export async function backfillUsageTeamIds(): Promise<number> {
  const accounts = await SajiloKanunAccount.find({ teamId: { $exists: true, $ne: null } }).select(
    "_id teamId"
  );
  let updated = 0;
  for (const account of accounts) {
    const result = await SajiloKanunTokenUsage.updateMany(
      { userId: account._id, $or: [{ teamId: { $exists: false } }, { teamId: null }] },
      { $set: { teamId: account.teamId } }
    );
    updated += result.modifiedCount;
  }
  return updated;
}
