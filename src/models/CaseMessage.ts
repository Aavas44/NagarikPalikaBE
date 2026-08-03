import mongoose, { Schema, type Document, type Types } from "mongoose";

export type CaseMessageSenderType = "firm" | "client";

export interface ICaseMessage extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  senderAccountId: Types.ObjectId;
  senderType: CaseMessageSenderType;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const caseMessageSchema = new Schema<ICaseMessage>(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "LegalCase",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    senderAccountId: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
    },
    senderType: { type: String, enum: ["firm", "client"], required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

caseMessageSchema.index({ caseId: 1, createdAt: 1, _id: 1 });

export const CaseMessage = mongoose.model<ICaseMessage>("CaseMessage", caseMessageSchema);

export function caseMessageToJson(
  message: ICaseMessage,
  sender?: { name?: string; username?: string } | null
) {
  return {
    id: message._id.toString(),
    caseId: message.caseId.toString(),
    teamId: message.teamId.toString(),
    senderAccountId: message.senderAccountId.toString(),
    senderType: message.senderType,
    senderName: sender?.name ?? "",
    senderUsername: sender?.username ?? "",
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}
