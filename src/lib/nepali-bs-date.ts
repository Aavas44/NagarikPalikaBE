import calendarRaw from "../data/nepali-calendar-data.json";

type BsDate = { year: number; month: number; day: number };

const CALENDAR = calendarRaw as Record<string, number[]>;
const REF_BS: BsDate = { year: 2000, month: 1, day: 1 };
const REF_AD_UTC = Date.UTC(1943, 3, 14);
const MIN_BS_YEAR = 2000;
const MAX_BS_YEAR = 2100;

const BS_MONTHS_NE = [
  "बैशाख",
  "जेठ",
  "असार",
  "श्रावण",
  "भाद्र",
  "आश्विन",
  "कार्तिक",
  "मंसिर",
  "पुष",
  "माघ",
  "फाल्गुन",
  "चैत्र",
] as const;

const TO_DEVANAGARI: Record<string, string> = {
  "0": "०",
  "1": "१",
  "2": "२",
  "3": "३",
  "4": "४",
  "5": "५",
  "6": "६",
  "7": "७",
  "8": "८",
  "9": "९",
};

export function toDevanagariDigits(value: string): string {
  return value.replace(/\d/g, (c) => TO_DEVANAGARI[c] ?? c);
}

function getDaysInBsMonth(year: number, month: number): number {
  if (year < MIN_BS_YEAR || year > MAX_BS_YEAR) return 30;
  if (month < 1 || month > 12) return 30;
  return CALENDAR[String(year)][month - 1] ?? 30;
}

function adToUtcMidnight(ad: Date): number {
  return Date.UTC(ad.getFullYear(), ad.getMonth(), ad.getDate());
}

function adToBs(ad: Date): BsDate {
  let daysDiff = Math.round((adToUtcMidnight(ad) - REF_AD_UTC) / 86_400_000);
  let bsYear = REF_BS.year;
  let bsMonth = REF_BS.month;
  let bsDay = REF_BS.day;

  if (daysDiff >= 0) {
    while (daysDiff > 0) {
      const daysInMonth = getDaysInBsMonth(bsYear, bsMonth);
      const daysRemainingInMonth = daysInMonth - bsDay + 1;
      if (daysDiff >= daysRemainingInMonth) {
        daysDiff -= daysRemainingInMonth;
        bsDay = 1;
        bsMonth += 1;
        if (bsMonth > 12) {
          bsMonth = 1;
          bsYear += 1;
        }
      } else {
        bsDay += daysDiff;
        daysDiff = 0;
      }
    }
  } else {
    while (daysDiff < 0) {
      bsDay -= 1;
      if (bsDay < 1) {
        bsMonth -= 1;
        if (bsMonth < 1) {
          bsMonth = 12;
          bsYear -= 1;
        }
        bsDay = getDaysInBsMonth(bsYear, bsMonth);
      }
      daysDiff += 1;
    }
  }

  return { year: bsYear, month: bsMonth, day: bsDay };
}

export function getTodayBsNepal(): BsDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return adToBs(new Date());
  return adToBs(new Date(year, month - 1, day));
}

/** Official-letter style: २०८३ साल भाद्र १२ गते */
export function formatTodayBsLongNe(): string {
  const date = getTodayBsNepal();
  const year = toDevanagariDigits(String(date.year));
  const day = toDevanagariDigits(String(date.day));
  const monthName = BS_MONTHS_NE[date.month - 1];
  return `${year} साल ${monthName} ${day} गते`;
}

/** Compact: २०८३/०५/१२ */
export function formatTodayBsShortNe(): string {
  const date = getTodayBsNepal();
  const year = toDevanagariDigits(String(date.year));
  const month = toDevanagariDigits(String(date.month).padStart(2, "0"));
  const day = toDevanagariDigits(String(date.day).padStart(2, "0"));
  return `${year}/${month}/${day}`;
}
