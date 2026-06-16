import { ConsultationEventLog } from "../models/ConsultationEventLog";
import type { ConsultationEventType } from "../types";
import type { Types } from "mongoose";

export async function logConsultationEvent(
  requestId: Types.ObjectId | string,
  event: ConsultationEventType,
  actorType: "user" | "advocate" | "admin" | "system",
  actorId?: Types.ObjectId | string,
  meta?: Record<string, unknown>
) {
  await ConsultationEventLog.create({
    requestId,
    actorType,
    actorId: actorId || undefined,
    event,
    meta,
  });
}
