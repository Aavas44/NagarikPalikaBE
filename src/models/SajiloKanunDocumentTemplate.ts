import mongoose, { Schema, type Document, type Types } from "mongoose";
import type { CourtType } from "../lib/court-type";
import {
  LEGAL_CASE_DOCUMENT_TITLES,
  type LegalCaseDocumentKind,
} from "./LegalCase";

export type SkTemplateVariableType = "text" | "date" | "number";

export interface ISkTemplateVariable {
  key: string;
  labelEn: string;
  labelNe: string;
  type: SkTemplateVariableType;
  required: boolean;
  /** Optional UI grouping (e.g. court, plaintiff_1, defendant_2). */
  section?: string;
}

export interface ISajiloKanunDocumentTemplate extends Document {
  slug: string;
  nameEn: string;
  nameNe: string;
  /** Romanized Nepali title for search/display (e.g. Tarikh Sakar Gari Paun). */
  nameRoman: string;
  descriptionEn: string;
  descriptionNe: string;
  /** Templates differ by court tier. */
  courtType: CourtType;
  /** Stable kind key — official form slug or LegalCaseDocumentKind */
  documentKind: string;
  variables: ISkTemplateVariable[];
  fileType: "docx" | "pdf";
  storageKey: string;
  originalFileName: string;
  status: "draft" | "published";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const variableSchema = new Schema<ISkTemplateVariable>(
  {
    key: { type: String, required: true, trim: true },
    labelEn: { type: String, required: true, trim: true },
    labelNe: { type: String, default: "", trim: true },
    type: {
      type: String,
      enum: ["text", "date", "number"],
      default: "text",
    },
    required: { type: Boolean, default: true },
    section: { type: String, default: "", trim: true, maxlength: 80 },
  },
  { _id: false }
);

const sajiloKanunDocumentTemplateSchema = new Schema<ISajiloKanunDocumentTemplate>(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    nameEn: { type: String, required: true, trim: true },
    nameNe: { type: String, default: "", trim: true },
    nameRoman: { type: String, default: "", trim: true, index: true },
    descriptionEn: { type: String, default: "", trim: true },
    descriptionNe: { type: String, default: "", trim: true },
    courtType: {
      type: String,
      enum: ["district", "high", "supreme", "special"],
      required: true,
      index: true,
    },
    documentKind: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    variables: { type: [variableSchema], default: [] },
    fileType: { type: String, enum: ["docx", "pdf"], required: true },
    storageKey: { type: String, required: true },
    originalFileName: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

sajiloKanunDocumentTemplateSchema.index(
  { courtType: 1, documentKind: 1, status: 1 }
);

export const SajiloKanunDocumentTemplate =
  mongoose.model<ISajiloKanunDocumentTemplate>(
    "SajiloKanunDocumentTemplate",
    sajiloKanunDocumentTemplateSchema
  );

export function sajiloKanunDocumentTemplateToJson(
  template: ISajiloKanunDocumentTemplate
) {
  return {
    id: template._id.toString(),
    slug: template.slug,
    name: {
      en: template.nameEn,
      ne: template.nameNe || template.nameEn,
      roman: template.nameRoman || "",
    },
    description: {
      en: template.descriptionEn,
      ne: template.descriptionNe || template.descriptionEn,
    },
    courtType: template.courtType,
    documentKind: template.documentKind,
    documentKindTitle:
      LEGAL_CASE_DOCUMENT_TITLES[
        template.documentKind as keyof typeof LEGAL_CASE_DOCUMENT_TITLES
      ] ?? template.nameNe ?? template.documentKind,
    variables: template.variables.map((v) => ({
      key: v.key,
      label: { en: v.labelEn, ne: v.labelNe || v.labelEn },
      type: v.type,
      required: v.required,
      section: v.section || "",
    })),
    fileType: template.fileType,
    originalFileName: template.originalFileName,
    status: template.status,
    hasFile: Boolean(template.storageKey),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
