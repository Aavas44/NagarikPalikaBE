/** Court tier used for Sajilo Kanun cases and document templates. */

export type CourtType = "district" | "high" | "supreme" | "special";

export const COURT_TYPES: CourtType[] = [
  "district",
  "high",
  "supreme",
  "special",
];

export const COURT_TYPE_META: Record<
  CourtType,
  {
    labelNe: string;
    labelEn: string;
    /** Maps to Court catalog category when applicable. */
    catalogCategory: "district_courts" | "high_courts" | "special_courts" | null;
    defaultCourtNameNe: string;
    defaultCourtNameEn: string;
  }
> = {
  district: {
    labelNe: "जिल्ला अदालत",
    labelEn: "District Court",
    catalogCategory: "district_courts",
    defaultCourtNameNe: "जिल्ला अदालत",
    defaultCourtNameEn: "District Court",
  },
  high: {
    labelNe: "उच्च अदालत",
    labelEn: "High Court",
    catalogCategory: "high_courts",
    defaultCourtNameNe: "उच्च अदालत",
    defaultCourtNameEn: "High Court",
  },
  supreme: {
    labelNe: "सर्वोच्च अदालत",
    labelEn: "Supreme Court",
    catalogCategory: null,
    defaultCourtNameNe: "सर्वोच्च अदालत",
    defaultCourtNameEn: "Supreme Court",
  },
  special: {
    labelNe: "विशेष अदालत",
    labelEn: "Special Court",
    catalogCategory: "special_courts",
    defaultCourtNameNe: "विशेष अदालत",
    defaultCourtNameEn: "Special Court",
  },
};

export function isCourtType(value: unknown): value is CourtType {
  return (
    value === "district" ||
    value === "high" ||
    value === "supreme" ||
    value === "special"
  );
}

export function parseCourtType(value: unknown): CourtType | null {
  return isCourtType(value) ? value : null;
}

/** Infer court type from legacy courtCategory when courtType was not stored. */
export function courtTypeFromCategory(
  category: string | null | undefined
): CourtType | null {
  if (category === "district_courts") return "district";
  if (category === "high_courts") return "high";
  if (category === "special_courts") return "special";
  return null;
}
