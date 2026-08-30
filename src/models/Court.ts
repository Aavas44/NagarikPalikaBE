import mongoose, { Schema, type Document } from "mongoose";

/** Stable category identifiers for Nepal court catalog. */
export type CourtCategory =
  | "special_courts"
  | "high_courts"
  | "district_courts";

export const COURT_CATEGORY_META: Record<
  CourtCategory,
  { labelEn: string; labelNe: string; sortOrder: number }
> = {
  special_courts: {
    labelEn: "Special Courts",
    labelNe: "विशेष/विशेषीकृत अदालतहरू",
    sortOrder: 1,
  },
  high_courts: {
    labelEn: "High Courts & Benches",
    labelNe: "उच्च अदालत तथा इजलासहरू",
    sortOrder: 2,
  },
  district_courts: {
    labelEn: "District Courts",
    labelNe: "जिल्ला अदालतहरू",
    sortOrder: 3,
  },
};

export interface ICourt extends Document {
  /** e.g. district_courts */
  category: CourtCategory;
  /** Stable unique key: `{category}:{slug}` */
  code: string;
  /** Display name in Nepali (as used officially / in forms) */
  name: string;
  /** Optional English label */
  nameEn?: string;
  /**
   * Supreme Court daily cause-list id
   * (https://supremecourt.gov.np/weekly_dainik/pesi/daily/{scDailyId})
   */
  scDailyId?: number | null;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courtSchema = new Schema<ICourt>(
  {
    category: {
      type: String,
      required: true,
      enum: ["special_courts", "high_courts", "district_courts"],
      index: true,
    },
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    nameEn: { type: String, trim: true, maxlength: 200 },
    scDailyId: { type: Number, default: null, index: true },
    sortOrder: { type: Number, required: true, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courtSchema.index({ category: 1, sortOrder: 1 });
courtSchema.index({ category: 1, name: 1 }, { unique: true });
courtSchema.index(
  { scDailyId: 1 },
  { unique: true, partialFilterExpression: { scDailyId: { $type: "number" } } }
);

export const Court = mongoose.model<ICourt>("Court", courtSchema);

export function courtToJson(court: ICourt) {
  const meta = COURT_CATEGORY_META[court.category];
  const scDailyId =
    typeof court.scDailyId === "number" ? court.scDailyId : null;
  return {
    id: court._id.toString(),
    code: court.code,
    category: court.category,
    categoryLabelEn: meta.labelEn,
    categoryLabelNe: meta.labelNe,
    name: court.name,
    nameEn: court.nameEn ?? null,
    scDailyId,
    scDailyUrl: scDailyId
      ? `https://supremecourt.gov.np/weekly_dainik/pesi/daily/${scDailyId}`
      : null,
    sortOrder: court.sortOrder,
    active: court.active,
  };
}
