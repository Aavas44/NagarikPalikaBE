import mongoose, { Schema, type Document, type Types } from "mongoose";

export type SajiloKanunAccountRole = "admin" | "member";

export interface ISajiloKanunAccount extends Document {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  contactNo?: string;
  active: boolean;
  teamId?: Types.ObjectId;
  role?: SajiloKanunAccountRole;
  createdBy?: Types.ObjectId;
  platformUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<ISajiloKanunAccount>(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    contactNo: { type: String, trim: true, maxlength: 30 },
    active: { type: Boolean, default: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", index: true },
    role: { type: String, enum: ["admin", "member"] },
    createdBy: { type: Schema.Types.ObjectId },
    platformUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
      index: true,
    },
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
    contactNo: account.contactNo ?? "",
    active: account.active,
    teamId: account.teamId?.toString() ?? null,
    role: account.role ?? null,
    userType: account.role === "admin" ? "Firm admin" : account.role === "member" ? "Member" : null,
    createdAt: account.createdAt.toISOString(),
    createdBy: account.createdBy?.toString() ?? null,
  };
}
