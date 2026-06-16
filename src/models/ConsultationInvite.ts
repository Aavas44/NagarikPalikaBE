import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { InviteStatus, InviteTier } from "../types";

export interface IConsultationInvite extends Document {
  requestId: Types.ObjectId;
  advocateId: Types.ObjectId;
  tier: InviteTier;
  status: InviteStatus;
  notifiedAt: Date;
  respondedAt?: Date;
}

const consultationInviteSchema = new Schema<IConsultationInvite>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "ConsultationRequest", required: true },
    advocateId: { type: Schema.Types.ObjectId, ref: "AdvocateProfile", required: true },
    tier: { type: String, enum: ["selected", "open_pool"], required: true },
    status: {
      type: String,
      enum: ["notified", "accepted", "declined", "expired"],
      default: "notified",
    },
    notifiedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);

consultationInviteSchema.index({ requestId: 1, advocateId: 1 }, { unique: true });

export const ConsultationInvite = mongoose.model<IConsultationInvite>(
  "ConsultationInvite",
  consultationInviteSchema
);
