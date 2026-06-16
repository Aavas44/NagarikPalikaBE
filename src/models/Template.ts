import mongoose, { Schema, type Document } from "mongoose";
import type { Category, Status } from "../types";

export interface ITemplate extends Document {
  slug: string;
  name: { en: string; ne: string };
  description: { en: string; ne: string };
  category: Category;
  fileName: string;
  fileType: "docx" | "pdf";
  downloads: number;
  status: Status;
  previewEmoji: string;
  previewGradient: string;
  createdAt: Date;
  updatedAt: Date;
}

const templateSchema = new Schema<ITemplate>(
  {
    slug: { type: String, required: true, unique: true },
    name: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    description: {
      en: { type: String, required: true },
      ne: { type: String, required: true },
    },
    category: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: ["docx", "pdf"], required: true },
    downloads: { type: Number, default: 0 },
    status: { type: String, enum: ["published", "draft"], default: "draft" },
    previewEmoji: { type: String, required: true },
    previewGradient: { type: String, required: true },
  },
  { timestamps: true }
);

export const Template = mongoose.model<ITemplate>("Template", templateSchema);

export function templateToJson(tmpl: ITemplate) {
  return {
    id: tmpl.slug,
    name: tmpl.name,
    description: tmpl.description,
    category: tmpl.category,
    fileName: tmpl.fileName,
    fileType: tmpl.fileType,
    downloads: tmpl.downloads,
    uploaded: (tmpl.createdAt ?? new Date()).toISOString().split("T")[0],
    status: tmpl.status,
    previewEmoji: tmpl.previewEmoji,
    previewGradient: tmpl.previewGradient,
  };
}
