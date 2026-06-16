import { AdvocateProfile } from "../models/AdvocateProfile";
import { ConsultationInvite } from "../models/ConsultationInvite";
import {
  ConsultationRequest,
  type IConsultationRequest,
} from "../models/ConsultationRequest";
import { SELECTED_ADVOCATE_WINDOW_MS } from "../types";
import { logConsultationEvent } from "./consultationEvents";

export async function findMatchingAdvocates(
  specialty: string,
  province: string,
  district: string,
  excludeIds: string[] = []
) {
  return AdvocateProfile.find({
    status: "approved",
    specialties: specialty,
    provinces: province,
    districts: district,
    _id: { $nin: excludeIds },
  });
}

export async function notifySelectedAdvocates(request: IConsultationRequest) {
  const windowEnd = new Date(Date.now() + SELECTED_ADVOCATE_WINDOW_MS);
  request.selectedWindowEndsAt = windowEnd;
  request.status = "pending_selected";
  await request.save();

  const invites = request.selectedAdvocateIds.map((advocateId) => ({
    requestId: request._id,
    advocateId,
    tier: "selected" as const,
    status: "notified" as const,
    notifiedAt: new Date(),
  }));

  if (invites.length > 0) {
    await ConsultationInvite.insertMany(invites, { ordered: false }).catch(() => {
      /* ignore duplicate key */
    });
  }

  await logConsultationEvent(request._id, "selected_advocates_notified", "system", undefined, {
    advocateCount: invites.length,
    windowEndsAt: windowEnd.toISOString(),
  });

  if (invites.length === 0) {
    await openPoolForRequest(request);
  }
}

export async function openPoolForRequest(request: IConsultationRequest) {
  if (request.status === "accepted" || request.status === "open_pool") {
    return request;
  }

  const matching = await findMatchingAdvocates(
    request.specialty,
    request.province,
    request.district,
    request.selectedAdvocateIds.map((id) => id.toString())
  );

  const invites = matching.map((adv) => ({
    requestId: request._id,
    advocateId: adv._id,
    tier: "open_pool" as const,
    status: "notified" as const,
    notifiedAt: new Date(),
  }));

  if (invites.length > 0) {
    await ConsultationInvite.insertMany(invites, { ordered: false }).catch(() => {
      /* ignore duplicates */
    });
  }

  request.status = "open_pool";
  request.poolOpenedAt = new Date();
  await request.save();

  await ConsultationInvite.updateMany(
    { requestId: request._id, tier: "selected", status: "notified" },
    { status: "expired", respondedAt: new Date() }
  );

  await logConsultationEvent(request._id, "pool_opened", "system", undefined, {
    advocateCount: invites.length,
  });

  return request;
}

export async function processExpiredSelectedWindows() {
  const now = new Date();
  const expired = await ConsultationRequest.find({
    status: "pending_selected",
    selectedWindowEndsAt: { $lte: now },
  });

  for (const request of expired) {
    const accepted = await ConsultationInvite.findOne({
      requestId: request._id,
      status: "accepted",
    });
    if (!accepted) {
      await openPoolForRequest(request);
    }
  }

  return expired.length;
}

export async function activateConsultationAfterPayment(requestId: string) {
  const request = await ConsultationRequest.findById(requestId);
  if (!request) throw new Error("Request not found");

  request.paidAt = new Date();
  await request.save();

  if (request.selectedAdvocateIds.length > 0) {
    await notifySelectedAdvocates(request);
  } else {
    await openPoolForRequest(request);
  }

  return request;
}
