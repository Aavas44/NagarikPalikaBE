import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICaseUploadedDocument extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const caseUploadedDocumentSchema = new Schema<ICaseUploadedDocument>(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "LegalCase",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
      index: true,
    },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    size: { type: Number, required: true, min: 1 },
    storageKey: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

caseUploadedDocumentSchema.index({ caseId: 1, createdAt: -1 });
caseUploadedDocumentSchema.index({ teamId: 1, caseId: 1, createdAt: -1 });
caseUploadedDocumentSchema.index({ teamId: 1, uploadedBy: 1 });

export const CaseUploadedDocument = mongoose.model<ICaseUploadedDocument>(
  "CaseUploadedDocument",
  caseUploadedDocumentSchema
);

export function caseUploadedDocumentToJson(
  doc: ICaseUploadedDocument,
  uploader?: { name?: string; username?: string } | null
) {
  return {
    id: doc._id.toString(),
    caseId: doc.caseId.toString(),
    teamId: doc.teamId.toString(),
    uploadedBy: doc.uploadedBy.toString(),
    uploaderName: uploader?.name ?? "",
    uploaderUsername: uploader?.username ?? "",
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
