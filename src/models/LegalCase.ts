import mongoose, { Schema, type Document, type Types } from "mongoose";

export type LegalCaseType = "civil" | "criminal" | "other";
export type LegalCaseStatus = "open" | "pending" | "closed";

export interface ILegalCase extends Document {
  teamId: Types.ObjectId;
  title: string;
  caseNo: string;
  type: LegalCaseType;
  status: LegalCaseStatus;
  notes?: string;
  assignedMemberIds: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const legalCaseSchema = new Schema<ILegalCase>(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    caseNo: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ["civil", "criminal", "other"], required: true },
    status: { type: String, enum: ["open", "pending", "closed"], default: "open" },
    notes: { type: String, maxlength: 5000 },
    assignedMemberIds: [{ type: Schema.Types.ObjectId, ref: "SajiloKanunAccount" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
  },
  { timestamps: true }
);

legalCaseSchema.index({ teamId: 1, caseNo: 1 }, { unique: true });
legalCaseSchema.index({ teamId: 1, status: 1 });
legalCaseSchema.index({ teamId: 1, assignedMemberIds: 1 });

export const LegalCase = mongoose.model<ILegalCase>("LegalCase", legalCaseSchema);

export function legalCaseToJson(legalCase: ILegalCase) {
  return {
    id: legalCase._id.toString(),
    teamId: legalCase.teamId.toString(),
    title: legalCase.title,
    caseNo: legalCase.caseNo,
    type: legalCase.type,
    status: legalCase.status,
    notes: legalCase.notes ?? "",
    assignedMemberIds: legalCase.assignedMemberIds.map((id) => id.toString()),
    createdBy: legalCase.createdBy.toString(),
    createdAt: legalCase.createdAt.toISOString(),
    updatedAt: legalCase.updatedAt.toISOString(),
  };
}
