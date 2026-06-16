import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { ConsultationEventType } from "../types";

export interface IConsultationEventLog extends Document {
  requestId: Types.ObjectId;
  actorType: "user" | "advocate" | "admin" | "system";
  actorId?: Types.ObjectId;
  event: ConsultationEventType;
  meta?: Record<string, unknown>;
}

const eventLogSchema = new Schema<IConsultationEventLog>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "ConsultationRequest", required: true },
    actorType: {
      type: String,
      enum: ["user", "advocate", "admin", "system"],
      required: true,
    },
    actorId: { type: Schema.Types.ObjectId },
    event: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

eventLogSchema.index({ requestId: 1, createdAt: 1 });

export const ConsultationEventLog = mongoose.model<IConsultationEventLog>(
  "ConsultationEventLog",
  eventLogSchema
);

export function eventLogToJson(log: IConsultationEventLog) {
  return {
    id: log._id.toString(),
    requestId: log.requestId.toString(),
    actorType: log.actorType,
    actorId: log.actorId?.toString(),
    event: log.event,
    meta: log.meta,
    createdAt: (log as { createdAt?: Date }).createdAt?.toISOString(),
  };
}
