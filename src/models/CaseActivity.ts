import mongoose, { Schema, type Document, type Types } from "mongoose";

export const CASE_ACTIVITY_TYPES = [
  "case_registration",
  "notice_service",
  "reply_filing",
  "hearing_date",
  "witness_testimony",
] as const;

export type CaseActivityType = (typeof CASE_ACTIVITY_TYPES)[number];

export const CASE_ACTIVITY_TYPE_LABELS: Record<
  CaseActivityType,
  { en: string; ne: string }
> = {
  case_registration: {
    en: "Case registration",
    ne: "मुद्दा दर्ता",
  },
  notice_service: {
    en: "Notice / service of notice",
    ne: "म्याद / म्याद तामेली",
  },
  reply_filing: {
    en: "Reply filing",
    ne: "प्रतिउत्तरपत्र दाखिल",
  },
  hearing_date: {
    en: "Hearing date",
    ne: "तारेख",
  },
  witness_testimony: {
    en: "Witness testimony",
    ne: "साक्षी बकपत्र",
  },
};

export interface ICaseActivity extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  activityType: CaseActivityType;
  bsYear: number;
  bsMonth: number;
  bsDay: number;
  activityDate: Date;
  note: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const caseActivitySchema = new Schema<ICaseActivity>(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "LegalCase",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    activityType: {
      type: String,
      enum: CASE_ACTIVITY_TYPES,
      required: true,
    },
    bsYear: { type: Number, required: true, min: 2000, max: 2100 },
    bsMonth: { type: Number, required: true, min: 1, max: 12 },
    bsDay: { type: Number, required: true, min: 1, max: 32 },
    activityDate: { type: Date, required: true, index: true },
    note: { type: String, default: "", trim: true, maxlength: 2000 },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
    },
  },
  { timestamps: true }
);

caseActivitySchema.index({ caseId: 1, activityDate: -1, _id: -1 });

export const CaseActivity = mongoose.model<ICaseActivity>(
  "CaseActivity",
  caseActivitySchema
);

export function caseActivityToJson(
  activity: ICaseActivity,
  creator?: { name?: string; username?: string } | null
) {
  const labels = CASE_ACTIVITY_TYPE_LABELS[activity.activityType];
  return {
    id: activity._id.toString(),
    caseId: activity.caseId.toString(),
    teamId: activity.teamId.toString(),
    activityType: activity.activityType,
    labelEn: labels.en,
    labelNe: labels.ne,
    bsYear: activity.bsYear,
    bsMonth: activity.bsMonth,
    bsDay: activity.bsDay,
    activityDate: activity.activityDate.toISOString(),
    note: activity.note ?? "",
    createdBy: activity.createdBy.toString(),
    createdByName: creator?.name ?? "",
    createdByUsername: creator?.username ?? "",
    createdAt: activity.createdAt.toISOString(),
    updatedAt: activity.updatedAt.toISOString(),
  };
}
