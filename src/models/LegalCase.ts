import mongoose, { Schema, type Document, type Types } from "mongoose";
import {
  courtTypeFromCategory,
  type CourtType,
} from "../lib/court-type";

export type LegalCaseType =
  | "civil"
  | "criminal"
  | "special_administrative"
  | "constitutional_writ";
export type LegalCaseStatus = "open" | "pending" | "closed";
export type LegalCaseParty = "plaintiff" | "defendant" | "other";
export type { CourtType };

export type LegalCaseDocumentKind =
  | "firadpatra"
  | "pratiuttarapatra"
  | "vakalatnama"
  | "warisnama"
  | "nivedan_awedan"
  | "adhikrit_warisnama"
  | "sadharan_warisnama"
  | "manjurinama"
  | "sampatti_rokka_nivedan"
  | "sampatti_fukuwa_nivedan"
  | "tayari_fatbari_nivedan"
  | "court_fee_subidha_nivedan"
  | "milis_jhikaune_nivedan"
  | "petboli_manish_bhuji_nivedan"
  | "sakkal_kagaj_pesh_nivedan"
  | "hajir_huna_aayeko_nivedan";

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
  /** Set when the user saves this draft into case files. */
  savedUploadId?: Types.ObjectId | null;
}

/** Structured facts from Document Extractor (Nepali-keyed JSON). */
export interface ICaseDocumentExtraction {
  facts: Record<string, unknown>;
  sourceFileNames: string[];
  model?: string;
  updatedBy: Types.ObjectId;
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
  /** Reference to Court catalog document */
  courtId?: Types.ObjectId | null;
  /** Stable court code e.g. district_courts:kathmandu */
  courtCode?: string | null;
  courtName?: string | null;
  courtNameEn?: string | null;
  /** Supreme Court daily cause-list id, copied from Court catalog when set */
  courtScDailyId?: number | null;
  courtCategory?: "special_courts" | "high_courts" | "district_courts" | null;
  /** District / High / Supreme / Special — drives document templates */
  courtType?: CourtType | null;
  assignedMemberIds: Types.ObjectId[];
  testimonials: ICaseTestimonial[];
  payments: ICasePayment[];
  documents: ICaseGeneratedDocument[];
  documentExtraction?: ICaseDocumentExtraction | null;
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
        "adhikrit_warisnama",
        "sadharan_warisnama",
        "manjurinama",
        "sampatti_rokka_nivedan",
        "sampatti_fukuwa_nivedan",
        "tayari_fatbari_nivedan",
        "court_fee_subidha_nivedan",
        "milis_jhikaune_nivedan",
        "petboli_manish_bhuji_nivedan",
        "sakkal_kagaj_pesh_nivedan",
        "hajir_huna_aayeko_nivedan",
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
    savedUploadId: {
      type: Schema.Types.ObjectId,
      ref: "CaseUploadedDocument",
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

const caseDocumentExtractionSchema = new Schema<ICaseDocumentExtraction>(
  {
    facts: { type: Schema.Types.Mixed, required: true },
    sourceFileNames: { type: [String], default: [] },
    model: { type: String, trim: true, maxlength: 120 },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "SajiloKanunAccount",
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
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
    courtId: { type: Schema.Types.ObjectId, ref: "Court", default: null, index: true },
    courtCode: { type: String, trim: true, maxlength: 120, default: null },
    courtName: { type: String, trim: true, maxlength: 200, default: null },
    courtNameEn: { type: String, trim: true, maxlength: 200, default: null },
    courtScDailyId: { type: Number, default: null },
    courtCategory: {
      type: String,
      enum: ["special_courts", "high_courts", "district_courts"],
      default: null,
    },
    courtType: {
      type: String,
      enum: ["district", "high", "supreme", "special"],
      default: null,
      index: true,
    },
    assignedMemberIds: [{ type: Schema.Types.ObjectId, ref: "SajiloKanunAccount" }],
    testimonials: { type: [caseTestimonialSchema], default: [] },
    payments: { type: [casePaymentSchema], default: [] },
    documents: { type: [caseDocumentSchema], default: [] },
    documentExtraction: { type: caseDocumentExtractionSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "SajiloKanunAccount", required: true },
  },
  { timestamps: true }
);

legalCaseSchema.index({ teamId: 1, caseNo: 1 }, { unique: true });
legalCaseSchema.index({ teamId: 1, status: 1 });
legalCaseSchema.index({ teamId: 1, assignedMemberIds: 1 });

export const LegalCase = mongoose.model<ILegalCase>("LegalCase", legalCaseSchema);

export const LEGAL_CASE_DOCUMENT_KINDS: LegalCaseDocumentKind[] = [
  "firadpatra",
  "pratiuttarapatra",
  "vakalatnama",
  "warisnama",
  "nivedan_awedan",
  "adhikrit_warisnama",
  "sadharan_warisnama",
  "manjurinama",
  "sampatti_rokka_nivedan",
  "sampatti_fukuwa_nivedan",
  "tayari_fatbari_nivedan",
  "court_fee_subidha_nivedan",
  "milis_jhikaune_nivedan",
  "petboli_manish_bhuji_nivedan",
  "sakkal_kagaj_pesh_nivedan",
  "hajir_huna_aayeko_nivedan",
];

export const LEGAL_CASE_DOCUMENT_TITLES: Record<LegalCaseDocumentKind, string> = {
  firadpatra: "फिरादपत्र",
  pratiuttarapatra: "प्रतिउत्तरपत्र",
  vakalatnama: "वकालतनामा",
  warisnama: "वारिसनामा",
  nivedan_awedan: "निवेदनपत्र",
  adhikrit_warisnama: "अधिकृत वारिसनामा",
  sadharan_warisnama: "साधारण वारिसनामा",
  manjurinama: "मन्जुरीनामा",
  sampatti_rokka_nivedan: "सम्पत्ति रोक्का निवेदन",
  sampatti_fukuwa_nivedan: "सम्पत्ति फुकुवा निवेदन",
  tayari_fatbari_nivedan: "तयारी फाटबारी निवेदन",
  court_fee_subidha_nivedan: "अदालत दस्तुर सुविधा निवेदन",
  milis_jhikaune_nivedan: "मिलिस झिकाइ आदेश गरिपाऊँ निवेदन",
  petboli_manish_bhuji_nivedan: "पेटबोलीका मानिस बुझीपाऊँ निवेदन",
  sakkal_kagaj_pesh_nivedan: "सक्कल कागज पेश गरिपाऊँ निवेदन",
  hajir_huna_aayeko_nivedan: "हाजिर हुन आएको बारे निवेदन",
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
    savedUploadId: item.savedUploadId ? item.savedUploadId.toString() : null,
  };
}

function documentExtractionToJson(item: ICaseDocumentExtraction | null | undefined) {
  if (!item || !item.facts) return null;
  return {
    facts: item.facts,
    sourceFileNames: item.sourceFileNames ?? [],
    model: item.model ?? "",
    updatedBy: item.updatedBy?.toString?.() ?? String(item.updatedBy ?? ""),
    createdAt: item.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: item.updatedAt?.toISOString?.() ?? new Date().toISOString(),
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
    courtId: legalCase.courtId ? legalCase.courtId.toString() : null,
    courtCode: legalCase.courtCode ?? null,
    courtName: legalCase.courtName ?? null,
    courtNameEn: legalCase.courtNameEn ?? null,
    courtScDailyId:
      typeof legalCase.courtScDailyId === "number"
        ? legalCase.courtScDailyId
        : null,
    courtCategory: legalCase.courtCategory ?? null,
    courtType:
      legalCase.courtType ??
      courtTypeFromCategory(legalCase.courtCategory) ??
      null,
    assignedMemberIds: legalCase.assignedMemberIds.map((id) => id.toString()),
    createdBy: legalCase.createdBy.toString(),
    createdAt: legalCase.createdAt.toISOString(),
    updatedAt: legalCase.updatedAt.toISOString(),
    testimonialCount: legalCase.testimonials?.length ?? 0,
    paymentCount: legalCase.payments?.length ?? 0,
    documentCount: legalCase.documents?.length ?? 0,
    hasDocumentExtraction: Boolean(legalCase.documentExtraction?.facts),
    hasFamilyTree: Boolean(
      (legalCase.documentExtraction?.facts as { वंशावली?: { व्यक्तिहरू?: unknown[] } } | undefined)
        ?.वंशावली?.व्यक्तिहरू?.length
    ),
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
    documentExtraction: documentExtractionToJson(legalCase.documentExtraction),
  };
}
