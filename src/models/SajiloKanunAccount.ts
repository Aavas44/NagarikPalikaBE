import mongoose, { Schema, type Document } from "mongoose";

export interface ISajiloKanunAccount extends Document {
  username: string;
  passwordHash: string;
  name: string;
  email?: string;
  active: boolean;
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
  },
  { timestamps: true }
);

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
    createdAt: account.createdAt.toISOString(),
  };
}
