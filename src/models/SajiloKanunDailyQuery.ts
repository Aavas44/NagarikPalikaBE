import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ISajiloKanunDailyQuery extends Document {
  userId: Types.ObjectId;
  dayKey: string;
  questionId: string;
  questionHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const dailyQuerySchema = new Schema<ISajiloKanunDailyQuery>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
      index: true,
    },
    dayKey: { type: String, required: true },
    questionId: { type: String, required: true, maxlength: 100 },
    questionHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  },
  { timestamps: true }
);

dailyQuerySchema.index({ userId: 1, dayKey: 1 }, { unique: true });

export const SajiloKanunDailyQuery =
  mongoose.model<ISajiloKanunDailyQuery>(
    "SajiloKanunDailyQuery",
    dailyQuerySchema
  );
