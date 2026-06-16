import mongoose, { Schema, type Document } from "mongoose";

export interface IQuickTag extends Document {
  en: string;
  ne: string;
  sortOrder: number;
}

const quickTagSchema = new Schema<IQuickTag>(
  {
    en: { type: String, required: true },
    ne: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const QuickTag = mongoose.model<IQuickTag>("QuickTag", quickTagSchema);
