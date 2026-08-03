import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICaseParticipant extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  accountId: Types.ObjectId;
  status: "active" | "revoked";
  addedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const caseParticipantSchema = new Schema<ICaseParticipant>(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "LegalCase",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
      index: true,
    },
    status: { type: String, enum: ["active", "revoked"], default: "active" },
    addedBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
  },
  { timestamps: true }
);

caseParticipantSchema.index({ caseId: 1, accountId: 1 }, { unique: true });
caseParticipantSchema.index({ accountId: 1, status: 1 });

export const CaseParticipant = mongoose.model<ICaseParticipant>(
  "CaseParticipant",
  caseParticipantSchema
);

export function caseParticipantToJson(
  participant: ICaseParticipant,
  account?: {
    name?: string;
    username?: string;
    contactNo?: string;
    email?: string;
    active?: boolean;
  } | null
) {
  return {
    id: participant._id.toString(),
    caseId: participant.caseId.toString(),
    teamId: participant.teamId.toString(),
    accountId: participant.accountId.toString(),
    status: participant.status,
    addedBy: participant.addedBy.toString(),
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
    name: account?.name ?? "",
    username: account?.username ?? "",
    contactNo: account?.contactNo ?? "",
    email: account?.email ?? "",
    accountActive: account?.active ?? true,
  };
}
