import mongoose, { Schema, type Document } from "mongoose";
import type { Status } from "../types";

export interface ILawyer extends Document {
  slug: string;
  firmName: { en: string; ne: string };
  lawyerName: { en: string; ne: string };
  officeLocation: { en: string; ne: string };
  rating: number;
  ratingCount: number;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
}

const lawyerSchema = new Schema<ILawyer>(
  {
    slug: { type: String, required: true, unique: true },
    firmName: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    lawyerName: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    officeLocation: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    rating: { type: Number, required: true, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    status: { type: String, enum: ["published", "draft"], default: "published" },
  },
  { timestamps: true }
);

export const Lawyer = mongoose.model<ILawyer>("Lawyer", lawyerSchema);

export function lawyerToJson(lawyer: ILawyer) {
  return {
    id: lawyer.slug,
    firmName: lawyer.firmName,
    lawyerName: lawyer.lawyerName,
    officeLocation: lawyer.officeLocation,
    rating: lawyer.rating,
    ratingCount: lawyer.ratingCount,
    status: lawyer.status,
  };
}
