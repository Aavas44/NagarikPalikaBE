import mongoose from "mongoose";
import {
  Court,
  COURT_CATEGORY_META,
  courtToJson,
  type CourtCategory,
} from "../models/Court";
import {
  NEPAL_COURT_SEED,
  courtCode,
  resolveCourtSlug,
} from "../data/nepal-courts";

/** Upsert the Nepal court catalog. Safe to run on every boot. */
export async function seedNepalCourts(): Promise<number> {
  let upserted = 0;
  const byCategory = new Map<CourtCategory, number>();

  for (let i = 0; i < NEPAL_COURT_SEED.length; i++) {
    const row = NEPAL_COURT_SEED[i]!;
    const categoryIndex = byCategory.get(row.category) ?? 0;
    byCategory.set(row.category, categoryIndex + 1);

    const slug = resolveCourtSlug(row, categoryIndex);
    const code = courtCode(row.category, slug);
    const categoryMeta = COURT_CATEGORY_META[row.category];
    const sortOrder = categoryMeta.sortOrder * 1000 + categoryIndex;

    await Court.findOneAndUpdate(
      { code },
      {
        $set: {
          category: row.category,
          code,
          name: row.name,
          nameEn: row.nameEn,
          scDailyId:
            typeof row.scDailyId === "number" ? row.scDailyId : null,
          sortOrder,
          active: true,
        },
      },
      { upsert: true, new: true }
    );
    upserted += 1;
  }

  return upserted;
}

export async function resolveCourtByIdOrCode(input: {
  courtId?: string | null;
  courtCode?: string | null;
}): Promise<{
  courtId: string;
  courtCode: string;
  courtName: string;
  courtNameEn: string | null;
  courtScDailyId: number | null;
  courtCategory: CourtCategory;
} | null> {
  const id = input.courtId?.trim();
  const code = input.courtCode?.trim();
  if (!id && !code) return null;

  const query =
    id && mongoose.Types.ObjectId.isValid(id)
      ? { _id: id, active: true }
      : code
        ? { code, active: true }
        : null;
  if (!query) return null;

  const court = await Court.findOne(query);
  if (!court) return null;

  return {
    courtId: court._id.toString(),
    courtCode: court.code,
    courtName: court.name,
    courtNameEn: court.nameEn?.trim() || null,
    courtScDailyId:
      typeof court.scDailyId === "number" ? court.scDailyId : null,
    courtCategory: court.category,
  };
}

export async function listCourtsGrouped() {
  const courts = await Court.find({ active: true }).sort({
    sortOrder: 1,
    name: 1,
  });

  const categories: CourtCategory[] = [
    "special_courts",
    "high_courts",
    "district_courts",
  ];

  return {
    categories: categories.map((category) => {
      const meta = COURT_CATEGORY_META[category];
      return {
        id: category,
        labelEn: meta.labelEn,
        labelNe: meta.labelNe,
        courts: courts
          .filter((c) => c.category === category)
          .map(courtToJson),
      };
    }),
    courts: courts.map(courtToJson),
  };
}
