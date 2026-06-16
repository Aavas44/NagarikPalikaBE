import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { AdvocateStatus } from "../types";

export interface IAdvocateProfile extends Document {
  userId: Types.ObjectId;
  firmName: string;
  advocateName: string;
  specialties: string[];
  provinces: string[];
  districts: string[];
  mobile: string;
  whatsapp?: string;
  viber?: string;
  bio?: string;
  status: AdvocateStatus;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  rejectionReason?: string;
}

const advocateProfileSchema = new Schema<IAdvocateProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    firmName: { type: String, required: true },
    advocateName: { type: String, required: true },
    specialties: { type: [String], required: true },
    provinces: { type: [String], required: true },
    districts: { type: [String], required: true },
    mobile: { type: String, required: true },
    whatsapp: { type: String },
    viber: { type: String },
    bio: { type: String },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

advocateProfileSchema.index({ specialties: 1, provinces: 1, districts: 1, status: 1 });

export const AdvocateProfile = mongoose.model<IAdvocateProfile>(
  "AdvocateProfile",
  advocateProfileSchema
);

export function advocateToJson(
  profile: IAdvocateProfile,
  options?: { includeContact?: boolean }
) {
  const base = {
    id: profile._id.toString(),
    userId: profile.userId.toString(),
    firmName: profile.firmName,
    advocateName: profile.advocateName,
    specialties: profile.specialties,
    provinces: profile.provinces,
    districts: profile.districts,
    bio: profile.bio,
    status: profile.status,
    approvedAt: profile.approvedAt?.toISOString(),
  };
  if (options?.includeContact) {
    return {
      ...base,
      mobile: profile.mobile,
      whatsapp: profile.whatsapp,
      viber: profile.viber,
    };
  }
  return base;
}
