import mongoose, { Schema, type Document } from "mongoose";
import type { Category, Status } from "../types";

export interface ITerm extends Document {
  slug: string;
  name: { en: string; ne: string };
  category: Category;
  definition: { en: string; ne: string };
  status: Status;
  createdAt: Date;
  updatedAt: Date;
}

const termSchema = new Schema<ITerm>(
  {
    slug: { type: String, required: true, unique: true },
    name: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    category: { type: String, required: true },
    definition: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    status: { type: String, enum: ["published", "draft"], default: "draft" },
  },
  { timestamps: true }
);

export const Term = mongoose.model<ITerm>("Term", termSchema);

export function termToJson(term: ITerm) {
  return {
    id: term.slug,
    name: term.name,
    category: term.category,
    definition: term.definition,
    lastUpdated: (term.updatedAt ?? term.createdAt).toISOString().split("T")[0],
    status: term.status,
  };
}
