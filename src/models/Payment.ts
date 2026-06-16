import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { PaymentProvider, PaymentStatus } from "../types";
import { CONSULT_FEE_NPR } from "../types";

export interface IPayment extends Document {
  requestId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: PaymentProvider;
  amountNpr: number;
  status: PaymentStatus;
  providerRef?: string;
  rawResponse?: Record<string, unknown>;
  paidAt?: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "ConsultationRequest", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, enum: ["esewa", "khalti"], required: true },
    amountNpr: { type: Number, default: CONSULT_FEE_NPR },
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    providerRef: { type: String },
    rawResponse: { type: Schema.Types.Mixed },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);

export function paymentToJson(payment: IPayment) {
  return {
    id: payment._id.toString(),
    requestId: payment.requestId.toString(),
    provider: payment.provider,
    amountNpr: payment.amountNpr,
    status: payment.status,
    providerRef: payment.providerRef,
    paidAt: payment.paidAt?.toISOString(),
  };
}
