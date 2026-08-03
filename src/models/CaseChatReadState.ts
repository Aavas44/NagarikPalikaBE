import mongoose, { Schema, type Document, type Types } from "mongoose";

/** Per-account last-read cursor for a case chat thread. */
export interface ICaseChatReadState extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  accountId: Types.ObjectId;
  lastReadAt: Date;
  lastReadMessageId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const caseChatReadStateSchema = new Schema<ICaseChatReadState>(
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
    lastReadAt: { type: Date, required: true },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "CaseMessage",
      default: null,
    },
  },
  { timestamps: true }
);

caseChatReadStateSchema.index({ caseId: 1, accountId: 1 }, { unique: true });
caseChatReadStateSchema.index({ teamId: 1, accountId: 1 });

export const CaseChatReadState = mongoose.model<ICaseChatReadState>(
  "CaseChatReadState",
  caseChatReadStateSchema
);
