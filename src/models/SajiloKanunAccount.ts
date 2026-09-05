import mongoose, { Schema, type Document, type Types } from "mongoose";

export type SajiloKanunAccountRole = "admin" | "member" | "caseUser";

export interface ISajiloKanunAccount extends Document {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  contactNo?: string;
  active: boolean;
  teamId?: Types.ObjectId;
  role?: SajiloKanunAccountRole;
  starredDocumentTemplateIds: Types.ObjectId[];
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
    role: { type: String, enum: ["admin", "member", "caseUser"] },
    starredDocumentTemplateIds: {
      type: [
        { type: Schema.Types.ObjectId, ref: "SajiloKanunDocumentTemplate" },
      ],
      default: [],
    },
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
  const role = account.role ?? null;
  return {
    id: account._id.toString(),
    username: account.username,
    name: account.name,
    email: account.email ?? "",
    contactNo: account.contactNo ?? "",
    active: account.active,
    teamId: account.teamId?.toString() ?? null,
    role,
    starredDocumentTemplateIds: (account.starredDocumentTemplateIds ?? []).map(
      (id) => id.toString()
    ),
    userType:
      role === "admin"
        ? "Firm admin"
        : role === "member"
          ? "Firm member"
          : role === "caseUser"
            ? "Case user"
            : null,
    createdAt: account.createdAt.toISOString(),
    createdBy: account.createdBy?.toString() ?? null,
  };
}
