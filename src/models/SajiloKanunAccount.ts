import mongoose, { Schema, type Document, type Types } from "mongoose";

export type SajiloKanunAccountRole = "admin" | "member";

export interface ISajiloKanunAccount extends Document {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  active: boolean;
  teamId?: Types.ObjectId;
  role?: SajiloKanunAccountRole;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<ISajiloKanunAccount>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    active: { type: Boolean, default: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", index: true },
    role: { type: String, enum: ["admin", "member"] },
    createdBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

accountSchema.index({ teamId: 1, role: 1 });

export const SajiloKanunAccount = mongoose.model<ISajiloKanunAccount>(
  "SajiloKanunAccount",
  accountSchema
);

export function sajiloKanunAccountToJson(account: ISajiloKanunAccount) {
  return {
    id: account._id.toString(),
    username: account.username,
    name: account.name,
    email: account.email ?? "",
    active: account.active,
    teamId: account.teamId?.toString() ?? null,
    role: account.role ?? null,
    createdAt: account.createdAt.toISOString(),
  };
}
