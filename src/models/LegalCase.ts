import mongoose, { Schema, type Document, type Types } from "mongoose";

export type LegalCaseType =
  | "civil"
  | "criminal"
  | "special_administrative"
  | "constitutional_writ";
export type LegalCaseStatus = "open" | "pending" | "closed";
export type LegalCaseParty = "plaintiff" | "defendant" | "other";

export type LegalCaseDocumentKind =
  | "firadpatra"
  | "pratiuttarapatra"
  | "vakalatnama"
  | "warisnama"
  | "nivedan_awedan";

export type LegalCaseDocumentStatus = "placeholder" | "ready";

export interface ICaseTestimonial {
  _id: Types.ObjectId;
  contactName: string;
  contactPhone: string;
  content: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

export interface ICasePayment {
  _id: Types.ObjectId;
  amount: number;
  currency: string;
  method?: string;
  note?: string;
  paidAt: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

export interface ICaseGeneratedDocument {
  _id: Types.ObjectId;
  kind: LegalCaseDocumentKind;
  title: string;
  status: LegalCaseDocumentStatus;
  /** Placeholder body until AI generation is wired. */
  content?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILegalCase extends Document {
  teamId: Types.ObjectId;
  title: string;
  caseNo: string;
  type: LegalCaseType;
  status: LegalCaseStatus;
  partySide?: LegalCaseParty;
  notes?: string;
  assignedMemberIds: Types.ObjectId[];
  testimonials: ICaseTestimonial[];
  payments: ICasePayment[];
  documents: ICaseGeneratedDocument[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const caseTestimonialSchema = new Schema<ICaseTestimonial>(
  {
    contactName: { type: String, required: true, trim: true, maxlength: 200 },
    contactPhone: { type: String, required: true, trim: true, maxlength: 40 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const casePaymentSchema = new Schema<ICasePayment>(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NPR", trim: true, maxlength: 8 },
    method: { type: String, trim: true, maxlength: 80 },
    note: { type: String, trim: true, maxlength: 1000 },
    paidAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const caseDocumentSchema = new Schema<ICaseGeneratedDocument>(
  {
    kind: {
      type: String,
      enum: [
        "firadpatra",
        "pratiuttarapatra",
        "vakalatnama",
        "warisnama",
        "nivedan_awedan",
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    status: {
      type: String,
      enum: ["placeholder", "ready"],
      default: "placeholder",
    },
    content: { type: String, maxlength: 50000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
  },
  { _id: true, timestamps: true }
);

const legalCaseSchema = new Schema<ILegalCase>(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    caseNo: { type: String, required: true, trim: true, maxlength: 80 },
    type: {
      type: String,
      enum: ["civil", "criminal", "special_administrative", "constitutional_writ"],
      required: true,
    },
    status: { type: String, enum: ["open", "pending", "closed"], default: "open" },
    partySide: { type: String, enum: ["plaintiff", "defendant", "other"], default: "plaintiff" },
    notes: { type: String, maxlength: 5000 },
    assignedMemberIds: [{ type: Schema.Types.ObjectId, ref: "SajiloKanunAccount" }],
    testimonials: { type: [caseTestimonialSchema], default: [] },
    payments: { type: [casePaymentSchema], default: [] },
    documents: { type: [caseDocumentSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
  },
  { timestamps: true }
);

legalCaseSchema.index({ teamId: 1, caseNo: 1 }, { unique: true });
legalCaseSchema.index({ teamId: 1, status: 1 });
legalCaseSchema.index({ teamId: 1, assignedMemberIds: 1 });

export const LegalCase = mongoose.model<ILegalCase>("LegalCase", legalCaseSchema);

export const LEGAL_CASE_DOCUMENT_TITLES: Record<LegalCaseDocumentKind, string> = {
  firadpatra: "फिरादपत्र",
  pratiuttarapatra: "प्रतिउत्तरपत्र",
  vakalatnama: "वकालतनामा",
  warisnama: "वारिसनामा",
  nivedan_awedan: "निवेदन / आवेदन",
};

function testimonialToJson(item: ICaseTestimonial) {
  return {
    id: item._id.toString(),
    contactName: item.contactName,
    contactPhone: item.contactPhone,
    content: item.content,
    createdBy: item.createdBy.toString(),
    createdAt: item.createdAt.toISOString(),
  };
}

function paymentToJson(item: ICasePayment) {
  return {
    id: item._id.toString(),
    amount: item.amount,
    currency: item.currency || "NPR",
    method: item.method ?? "",
    note: item.note ?? "",
    paidAt: item.paidAt.toISOString(),
    createdBy: item.createdBy.toString(),
    createdAt: item.createdAt.toISOString(),
  };
}

function documentToJson(item: ICaseGeneratedDocument) {
  return {
    id: item._id.toString(),
    kind: item.kind,
    title: item.title,
    status: item.status,
    content: item.content ?? "",
    createdBy: item.createdBy.toString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function legalCaseToJson(
  legalCase: ILegalCase,
  options?: { detail?: boolean; payments?: boolean }
) {
  const base = {
    id: legalCase._id.toString(),
    teamId: legalCase.teamId.toString(),
    title: legalCase.title,
    caseNo: legalCase.caseNo,
    type: legalCase.type,
    status: legalCase.status,
    partySide: legalCase.partySide ?? "plaintiff",
    notes: legalCase.notes ?? "",
    assignedMemberIds: legalCase.assignedMemberIds.map((id) => id.toString()),
    createdBy: legalCase.createdBy.toString(),
    createdAt: legalCase.createdAt.toISOString(),
    updatedAt: legalCase.updatedAt.toISOString(),
    testimonialCount: legalCase.testimonials?.length ?? 0,
    paymentCount: legalCase.payments?.length ?? 0,
    documentCount: legalCase.documents?.length ?? 0,
  };

  if (!options?.detail) {
    if (!options?.payments) return base;
    return {
      ...base,
      payments: (legalCase.payments ?? []).map(paymentToJson),
    };
  }

  return {
    ...base,
    testimonials: (legalCase.testimonials ?? []).map(testimonialToJson),
    payments: (legalCase.payments ?? []).map(paymentToJson),
    documents: (legalCase.documents ?? []).map(documentToJson),
  };
}
