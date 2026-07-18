import mongoose, { Schema, type Document, type Types } from "mongoose";

export type RoleKey =
  | "platform.superadmin"
  | "platform.admin"
  | "sk.firm_admin"
  | "sk.member"
  | "sk.individual";

export interface IRolePolicy extends Document {
  roleKey: RoleKey;
  permissions: string[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const rolePolicySchema = new Schema<IRolePolicy>(
  {
    roleKey: {
      type: String,
      enum: [
        "platform.superadmin",
        "platform.admin",
        "sk.firm_admin",
        "sk.member",
        "sk.individual",
      ],
      required: true,
      unique: true,
      index: true,
    },
    permissions: [{ type: String, required: true }],
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const RolePolicy = mongoose.model<IRolePolicy>(
  "RolePolicy",
  rolePolicySchema
);
