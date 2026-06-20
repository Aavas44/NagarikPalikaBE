import mongoose, { Schema, type Document } from "mongoose";

export type FeedbackStatus = "new" | "reviewed";

export interface IFeedback extends Document {
  sessionId: string;
  name?: string;
  email?: string;
  message: string;
  locale?: "en" | "ne";
  status: FeedbackStatus;
  reviewedAt?: Date;
  reviewedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackSchema = new Schema<IFeedback>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    name: { type: String, trim: true, maxlength: 120 },
    email: { type: String, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    locale: { type: String, enum: ["en", "ne"] },
    status: { type: String, enum: ["new", "reviewed"], default: "new" },
    reviewedAt: { type: Date },
    reviewedBy: { type: String },
  },
  { timestamps: true }
);

export const Feedback = mongoose.model<IFeedback>("Feedback", feedbackSchema);

export function feedbackToJson(feedback: IFeedback) {
  return {
    id: feedback._id.toString(),
    sessionId: feedback.sessionId,
    name: feedback.name ?? "",
    email: feedback.email ?? "",
    message: feedback.message,
    locale: feedback.locale ?? "en",
    status: feedback.status,
    reviewedAt: feedback.reviewedAt?.toISOString() ?? null,
    createdAt: feedback.createdAt.toISOString(),
  };
}
