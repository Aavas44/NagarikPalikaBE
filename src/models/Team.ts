import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ITeam extends Document {
  name: string;
  active: boolean;
  /** Lifetime AI/RAG request pool for the whole firm. null = unlimited. */
  aiRequestsLimit: number | null;
  /** Max cases the firm may have. null = unlimited. */
  casesLimit: number | null;
  /** Max generated case documents across the firm. null = unlimited. */
  documentsLimit: number | null;
  /** Lifetime AI requests consumed by firm admin + members. */
  aiRequestsUsed: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    active: { type: Boolean, default: true },
    aiRequestsLimit: { type: Number, default: null, min: 0 },
    casesLimit: { type: Number, default: null, min: 0 },
    documentsLimit: { type: Number, default: null, min: 0 },
    aiRequestsUsed: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

teamSchema.index({ name: 1 });

export const Team = mongoose.model<ITeam>("Team", teamSchema);

export function teamToJson(team: ITeam) {
  return {
    id: team._id.toString(),
    name: team.name,
    active: team.active,
    aiRequestsLimit: team.aiRequestsLimit ?? null,
    casesLimit: team.casesLimit ?? null,
    documentsLimit: team.documentsLimit ?? null,
    aiRequestsUsed: team.aiRequestsUsed ?? 0,
    createdBy: team.createdBy?.toString() ?? null,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}

/** Parse admin input: empty/null/undefined => unlimited (null); else non-negative int. */
export function parseOptionalQuotaLimit(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error("Quota limits must be non-negative whole numbers or empty for unlimited");
  }
  return n;
}
