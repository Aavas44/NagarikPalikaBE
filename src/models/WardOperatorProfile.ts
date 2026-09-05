import mongoose, { Schema, type Document, type Types } from "mongoose";
import { wardOperatorDisplayEmail, wardGenerationQuotaFromProfile } from "../services/ward-operator-utils";

export type LocalBodyType = "nagarpalika" | "gaupalika" | "mahanagarpalika";

export interface IWardOperatorProfile extends Document {
  userId: Types.ObjectId;
  username: string;
  operatorName: string;
  districtName: string;
  wardNo: string;
  localBodyType: LocalBodyType;
  localBodyName: string;
  formerLocalBodyType: LocalBodyType;
  formerLocalBodyName: string;
  formerWardNo: string;
  generationLimit: number | null;
  generationCount: number;
  starredTemplateIds: Types.ObjectId[];
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const wardOperatorProfileSchema = new Schema<IWardOperatorProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    operatorName: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    districtName: { type: String, required: true, trim: true },
    wardNo: { type: String, required: true, trim: true },
    localBodyType: {
      type: String,
      enum: ["nagarpalika", "gaupalika", "mahanagarpalika"],
      required: true,
    },
    localBodyName: { type: String, required: true, trim: true },
    formerLocalBodyType: {
      type: String,
      enum: ["nagarpalika", "gaupalika", "mahanagarpalika"],
      required: true,
      default: "nagarpalika",
    },
    formerLocalBodyName: { type: String, required: true, trim: true },
    formerWardNo: { type: String, required: true, trim: true },
    generationLimit: { type: Number, default: null, min: 1 },
    generationCount: { type: Number, default: 0, min: 0 },
    starredTemplateIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "WardDocumentTemplate" }],
      default: [],
    },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const WardOperatorProfile = mongoose.model<IWardOperatorProfile>(
  "WardOperatorProfile",
  wardOperatorProfileSchema
);

export function wardOperatorProfileToJson(
  profile: IWardOperatorProfile,
  user?: { id: string; email: string; name: string } | null
) {
  const quota = wardGenerationQuotaFromProfile(profile);
  return {
    id: profile._id.toString(),
    userId: profile.userId.toString(),
    username: profile.username,
    operatorName: profile.operatorName,
    districtName: profile.districtName,
    wardNo: profile.wardNo,
    localBodyType: profile.localBodyType,
    localBodyName: profile.localBodyName,
    formerLocalBodyType: profile.formerLocalBodyType,
    formerLocalBodyName: profile.formerLocalBodyName,
    formerWardNo: profile.formerWardNo,
    generationLimit: quota.limit,
    generationCount: quota.used,
    generationRemaining: quota.remaining,
    generationUnlimited: quota.unlimited,
    starredTemplateIds: (profile.starredTemplateIds ?? []).map((id) =>
      id.toString()
    ),
    active: profile.active,
    email: wardOperatorDisplayEmail(user?.email ?? null),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
