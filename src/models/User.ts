import mongoose, { Schema, type Document } from "mongoose";
import type { UserType } from "../types";

export interface IUser extends Document {
  name: string;
  email: string;
  userType: UserType;
  authProvider: "google" | "local";
  passwordHash?: string;
  googleId?: string;
  avatarUrl?: string;
  phone?: string;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    userType: {
      type: String,
      enum: ["user", "advocate", "admin"],
      default: "user",
    },
    authProvider: { type: String, enum: ["google", "local"], default: "local" },
    passwordHash: { type: String },
    googleId: { type: String, sparse: true, unique: true },
    avatarUrl: { type: String },
    phone: { type: String },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);

export function userToJson(user: IUser) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    userType: user.userType,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
  };
}
