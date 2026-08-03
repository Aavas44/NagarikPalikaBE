import mongoose from "mongoose";
import { CaseChatReadState } from "../models/CaseChatReadState";
import { CaseMessage } from "../models/CaseMessage";
import { LegalCase } from "../models/LegalCase";
import { SajiloKanunAccount } from "../models/SajiloKanunAccount";

export async function markCaseMessagesRead(input: {
  caseId: string;
  teamId: string;
  accountId: string;
  lastReadMessageId?: string | null;
}) {
  const now = new Date();
  let lastReadMessageId: mongoose.Types.ObjectId | null = null;
  let lastReadAt = now;

  if (
    input.lastReadMessageId &&
    mongoose.Types.ObjectId.isValid(input.lastReadMessageId)
  ) {
    const latest = await CaseMessage.findOne({
      _id: input.lastReadMessageId,
      caseId: input.caseId,
    }).select("_id createdAt");
    if (latest) {
      lastReadMessageId = latest._id;
      lastReadAt = latest.createdAt;
    }
  } else {
    const latest = await CaseMessage.findOne({ caseId: input.caseId })
      .sort({ createdAt: -1, _id: -1 })
      .select("_id createdAt");
    if (latest) {
      lastReadMessageId = latest._id;
      lastReadAt = latest.createdAt;
    }
  }

  const state = await CaseChatReadState.findOneAndUpdate(
    {
      caseId: new mongoose.Types.ObjectId(input.caseId),
      accountId: new mongoose.Types.ObjectId(input.accountId),
    },
    {
      $set: {
        teamId: new mongoose.Types.ObjectId(input.teamId),
        lastReadAt,
        lastReadMessageId,
      },
      $setOnInsert: {
        caseId: new mongoose.Types.ObjectId(input.caseId),
        accountId: new mongoose.Types.ObjectId(input.accountId),
      },
    },
    { upsert: true, new: true }
  );

  return state;
}

export async function countUnreadClientMessages(input: {
  caseId: string;
  accountId: string;
}) {
  const state = await CaseChatReadState.findOne({
    caseId: input.caseId,
    accountId: input.accountId,
  }).select("lastReadAt");

  const filter: Record<string, unknown> = {
    caseId: input.caseId,
    senderType: "client",
  };
  if (state?.lastReadAt) {
    filter.createdAt = { $gt: state.lastReadAt };
  }

  return CaseMessage.countDocuments(filter);
}

export type UnreadClientThread = {
  caseId: string;
  caseTitle: string;
  caseNo: string;
  caseStatus: string;
  unreadCount: number;
  latestMessageId: string;
  latestBody: string;
  latestSenderName: string;
  latestAt: string;
};

export async function listUnreadClientThreadsForAccount(input: {
  accountId: string;
  caseIds: mongoose.Types.ObjectId[];
}): Promise<{ totalUnread: number; threads: UnreadClientThread[] }> {
  if (input.caseIds.length === 0) {
    return { totalUnread: 0, threads: [] };
  }

  const readStates = await CaseChatReadState.find({
    accountId: input.accountId,
    caseId: { $in: input.caseIds },
  }).select("caseId lastReadAt");
  const lastReadByCase = new Map(
    readStates.map((s) => [s.caseId.toString(), s.lastReadAt as Date])
  );

  const cases = await LegalCase.find({ _id: { $in: input.caseIds } })
    .select("_id title caseNo status")
    .lean();
  const caseById = new Map(cases.map((c) => [c._id.toString(), c]));

  const clientMessages = await CaseMessage.find({
    caseId: { $in: input.caseIds },
    senderType: "client",
  })
    .sort({ createdAt: -1, _id: -1 })
    .select("caseId senderAccountId body createdAt");

  const unreadByCase = new Map<
    string,
    { count: number; latest: (typeof clientMessages)[number] }
  >();

  for (const message of clientMessages) {
    const caseId = message.caseId.toString();
    const lastReadAt = lastReadByCase.get(caseId);
    if (lastReadAt && message.createdAt <= lastReadAt) continue;

    const existing = unreadByCase.get(caseId);
    if (!existing) {
      unreadByCase.set(caseId, { count: 1, latest: message });
    } else {
      existing.count += 1;
    }
  }

  const senderIds = [
    ...new Set(
      [...unreadByCase.values()].map((row) => row.latest.senderAccountId.toString())
    ),
  ];
  const accounts = await SajiloKanunAccount.find({
    _id: { $in: senderIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).select("name username");
  const accountById = new Map(accounts.map((a) => [a._id.toString(), a]));

  const threads: UnreadClientThread[] = [];
  let totalUnread = 0;

  for (const [caseId, row] of unreadByCase) {
    const legalCase = caseById.get(caseId);
    const sender = accountById.get(row.latest.senderAccountId.toString());
    totalUnread += row.count;
    threads.push({
      caseId,
      caseTitle: legalCase?.title ?? "",
      caseNo: legalCase?.caseNo ?? "",
      caseStatus: legalCase?.status ?? "open",
      unreadCount: row.count,
      latestMessageId: row.latest._id.toString(),
      latestBody: row.latest.body,
      latestSenderName: sender?.name || sender?.username || "Case user",
      latestAt: row.latest.createdAt.toISOString(),
    });
  }

  threads.sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt));
  return { totalUnread, threads };
}
