import mongoose, { Schema, type Document, type Types } from "mongoose";

export interface ICasePesiRow extends Document {
  caseId: Types.ObjectId;
  teamId: Types.ObjectId;
  courtScDailyId: number;
  /** Hearing date as printed on SC list (BS string, e.g. २०८३-०४-१८) */
  pesiDate: string;
  sn: string;
  caseNoRaw: string;
  registrationDate: string;
  matter: string;
  parties: string;
  fantawala: string;
  signal: string;
  priority: string;
  remarks: string;
  /** Full row cells as received (table order) */
  cells: string[];
  fetchedAt: Date;
  fetchedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const casePesiRowSchema = new Schema<ICasePesiRow>(
  {
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "LegalCase",
      required: true,
      index: true,
    },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    courtScDailyId: { type: Number, required: true },
    pesiDate: { type: String, required: true, trim: true, maxlength: 40 },
    sn: { type: String, default: "", trim: true, maxlength: 40 },
    caseNoRaw: { type: String, required: true, trim: true, maxlength: 200 },
    registrationDate: { type: String, default: "", trim: true, maxlength: 40 },
    matter: { type: String, default: "", trim: true, maxlength: 500 },
    parties: { type: String, default: "", trim: true, maxlength: 2000 },
    fantawala: { type: String, default: "", trim: true, maxlength: 200 },
    signal: { type: String, default: "", trim: true, maxlength: 80 },
    priority: { type: String, default: "", trim: true, maxlength: 200 },
    remarks: { type: String, default: "", trim: true, maxlength: 1000 },
    cells: { type: [String], default: [] },
    fetchedAt: { type: Date, required: true },
    fetchedBy: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
    },
  },
  { timestamps: true }
);

casePesiRowSchema.index(
  { caseId: 1, pesiDate: 1, caseNoRaw: 1 },
  { unique: true }
);
casePesiRowSchema.index({ caseId: 1, pesiDate: -1, _id: -1 });

export const CasePesiRow = mongoose.model<ICasePesiRow>(
  "CasePesiRow",
  casePesiRowSchema
);

export const CASE_PESI_COLUMNS = [
  { key: "sn", labelNe: "क्र स", labelEn: "S.N." },
  { key: "caseNoRaw", labelNe: "मुद्दा नं", labelEn: "Case no." },
  { key: "registrationDate", labelNe: "दर्ता मिती", labelEn: "Registration date" },
  { key: "matter", labelNe: "मुद्दा", labelEn: "Matter" },
  { key: "parties", labelNe: "पक्ष || विपक्ष", labelEn: "Parties" },
  { key: "fantawala", labelNe: "फाँटवाला", labelEn: "Section" },
  { key: "signal", labelNe: "संकेत", labelEn: "Signal" },
  { key: "priority", labelNe: "प्राथमिकता", labelEn: "Priority" },
  { key: "remarks", labelNe: "कैफियत", labelEn: "Remarks" },
] as const;

export function casePesiRowToJson(row: ICasePesiRow) {
  return {
    id: row._id.toString(),
    caseId: row.caseId.toString(),
    teamId: row.teamId.toString(),
    courtScDailyId: row.courtScDailyId,
    pesiDate: row.pesiDate,
    sn: row.sn,
    caseNoRaw: row.caseNoRaw,
    registrationDate: row.registrationDate,
    matter: row.matter,
    parties: row.parties,
    fantawala: row.fantawala,
    signal: row.signal,
    priority: row.priority,
    remarks: row.remarks,
    cells: row.cells ?? [],
    fetchedAt: row.fetchedAt.toISOString(),
    fetchedBy: row.fetchedBy.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
