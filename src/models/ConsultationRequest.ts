import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { ConsultationStatus } from "../types";
import { CONSULT_DURATION_MINUTES, CONSULT_FEE_NPR } from "../types";

export interface IConsultationRequest extends Document {
  userId: Types.ObjectId;
  name: string;
  specialty: string;
  contactNo: string;
  province: string;
  district: string;
  particulars: string;
  whatsapp?: string;
  viber?: string;
  selectedAdvocateIds: Types.ObjectId[];
  feeNpr: number;
  durationMinutes: number;
  status: ConsultationStatus;
  paymentId?: Types.ObjectId;
  acceptedByAdvocateId?: Types.ObjectId;
  acceptedAt?: Date;
  poolOpenedAt?: Date;
  selectedWindowEndsAt?: Date;
  contactRevealedAt?: Date;
  paidAt?: Date;
}

const consultationRequestSchema = new Schema<IConsultationRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    specialty: { type: String, required: true },
    contactNo: { type: String, required: true },
    province: { type: String, required: true },
    district: { type: String, required: true },
    particulars: { type: String, required: true },
    whatsapp: { type: String },
    viber: { type: String },
    selectedAdvocateIds: [{ type: Schema.Types.ObjectId, ref: "AdvocateProfile" }],
    feeNpr: { type: Number, default: CONSULT_FEE_NPR },
    durationMinutes: { type: Number, default: CONSULT_DURATION_MINUTES },
    status: {
      type: String,
      enum: [
        "payment_pending",
        "pending_selected",
        "open_pool",
        "accepted",
        "completed",
        "cancelled",
        "expired",
        "refunded",
      ],
      default: "payment_pending",
    },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    acceptedByAdvocateId: { type: Schema.Types.ObjectId, ref: "AdvocateProfile" },
    acceptedAt: { type: Date },
    poolOpenedAt: { type: Date },
    selectedWindowEndsAt: { type: Date },
    contactRevealedAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

export const ConsultationRequest = mongoose.model<IConsultationRequest>(
  "ConsultationRequest",
  consultationRequestSchema
);

export function consultationToJson(
  req: IConsultationRequest,
  options?: {
    includeUserContact?: boolean;
    includeAdvocateContact?: boolean;
    advocateContact?: {
      mobile?: string;
      whatsapp?: string;
      viber?: string;
      advocateName?: string;
      firmName?: string;
    };
  }
) {
  const base: Record<string, unknown> = {
    id: req._id.toString(),
    userId: req.userId.toString(),
    name: req.name,
    specialty: req.specialty,
    province: req.province,
    district: req.district,
    particulars: req.particulars,
    selectedAdvocateIds: req.selectedAdvocateIds.map((id) => id.toString()),
    feeNpr: req.feeNpr,
    durationMinutes: req.durationMinutes,
    status: req.status,
    acceptedByAdvocateId: req.acceptedByAdvocateId?.toString(),
    acceptedAt: req.acceptedAt?.toISOString(),
    poolOpenedAt: req.poolOpenedAt?.toISOString(),
    selectedWindowEndsAt: req.selectedWindowEndsAt?.toISOString(),
    contactRevealedAt: req.contactRevealedAt?.toISOString(),
    paidAt: req.paidAt?.toISOString(),
    createdAt: (req as { createdAt?: Date }).createdAt?.toISOString(),
  };

  if (options?.includeUserContact) {
    base.contactNo = req.contactNo;
    base.whatsapp = req.whatsapp;
    base.viber = req.viber;
  }

  if (options?.includeAdvocateContact && options.advocateContact) {
    base.advocateContact = options.advocateContact;
  }

  return base;
}
