import mongoose, { Schema, type Document } from "mongoose";

export type DemoRequestStatus = "new" | "reviewed" | "approved" | "rejected";

export interface IDemoRequest extends Document {
  sessionId: string;
  name: string;
  email: string;
  contactNo: string;
  profession: string;
  queries: string;
  locale?: "en" | "ne";
  status: DemoRequestStatus;
  reviewedAt?: Date;
  reviewedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const demoRequestSchema = new Schema<IDemoRequest>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    contactNo: { type: String, required: true, trim: true, maxlength: 30 },
    profession: { type: String, required: true, trim: true, maxlength: 200 },
    queries: { type: String, required: true, trim: true, maxlength: 2000 },
    locale: { type: String, enum: ["en", "ne"] },
    status: {
      type: String,
      enum: ["new", "reviewed", "approved", "rejected"],
      default: "new",
    },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
  },
  { timestamps: true }
);

export const DemoRequest = mongoose.model<IDemoRequest>("DemoRequest", demoRequestSchema);

export function demoRequestToJson(request: IDemoRequest) {
  return {
    id: request._id.toString(),
    sessionId: request.sessionId,
    name: request.name,
    email: request.email,
    contactNo: request.contactNo,
    profession: request.profession,
    queries: request.queries,
    locale: request.locale ?? "en",
    status: request.status,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  };
}
