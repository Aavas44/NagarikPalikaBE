import mongoose, { Schema, type Document, type Types } from "mongoose";

export type WardTemplateVariableType = "text" | "date" | "number";

export interface IWardTemplateVariable {
  key: string;
  labelEn: string;
  labelNe: string;
  type: WardTemplateVariableType;
  required: boolean;
}

export interface IWardDocumentTemplate extends Document {
  slug: string;
  nameEn: string;
  nameNe: string;
  descriptionEn: string;
  descriptionNe: string;
  variables: IWardTemplateVariable[];
  fileType: "docx" | "pdf";
  storageKey: string;
  originalFileName: string;
  status: "draft" | "published";
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const variableSchema = new Schema<IWardTemplateVariable>(
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
  },
  { _id: false }
);

const wardDocumentTemplateSchema = new Schema<IWardDocumentTemplate>(
  {
    slug: { type: String, required: true, unique: true, trim: true, index: true },
    nameEn: { type: String, required: true, trim: true },
    nameNe: { type: String, default: "", trim: true },
    descriptionEn: { type: String, default: "", trim: true },
    descriptionNe: { type: String, default: "", trim: true },
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

export const WardDocumentTemplate = mongoose.model<IWardDocumentTemplate>(
  "WardDocumentTemplate",
  wardDocumentTemplateSchema
);

export function wardDocumentTemplateToJson(template: IWardDocumentTemplate) {
  return {
    id: template._id.toString(),
    slug: template.slug,
    name: { en: template.nameEn, ne: template.nameNe || template.nameEn },
    description: {
      en: template.descriptionEn,
      ne: template.descriptionNe || template.descriptionEn,
    },
    variables: template.variables.map((v) => ({
      key: v.key,
      label: { en: v.labelEn, ne: v.labelNe || v.labelEn },
      type: v.type,
      required: v.required,
    })),
    fileType: template.fileType,
    originalFileName: template.originalFileName,
    status: template.status,
    hasFile: Boolean(template.storageKey),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
