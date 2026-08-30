const SC_WEEKLY_PESI_BASE =
  "https://supremecourt.gov.np/weekly_dainik/pesi/weekly_pesi";
const SC_DAILY_REFERER_BASE =
  "https://supremecourt.gov.np/weekly_dainik/pesi/daily";

const NEPALI_DIGITS = "०१२३४५६७८९";

export type ParsedPesiRow = {
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
  cells: string[];
};

export type FetchWeeklyPesiResult = {
  courtScDailyId: number;
  fetchedAt: string;
  totalRows: number;
  matchedRows: ParsedPesiRow[];
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
}

export function stripHtml(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

export function toAsciiDigits(input: string): string {
  return input.replace(/[०-९]/g, (d) => {
    const i = NEPALI_DIGITS.indexOf(d);
    return i >= 0 ? String(i) : d;
  });
}

/** Parse BS date strings like `२०८३-०४-१८` or `2083-04-18`. */
export function parseBsDateString(
  input: string
): { year: number; month: number; day: number } | null {
  const ascii = toAsciiDigits(input).trim();
  const match = ascii.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 32
  ) {
    return null;
  }
  return { year, month, day };
}

/** Normalize case numbers for fuzzy matching across Devanagari/ASCII. */
export function normalizeCaseNo(input: string): string {
  return toAsciiDigits(input)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function caseNoMatches(cellRaw: string, targetCaseNo: string): boolean {
  const target = normalizeCaseNo(targetCaseNo);
  if (!target) return false;

  const cell = stripHtml(cellRaw);
  const candidates = [
    cell,
    ...cell.split(/\n+/),
    ...cell.split(/[()]/),
  ]
    .map((part) => normalizeCaseNo(part))
    .filter(Boolean);

  return candidates.some(
    (c) => c === target || c.includes(target) || target.includes(c)
  );
}

function extractTdCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = tdRe.exec(rowHtml))) {
    cells.push(stripHtml(match[1] ?? ""));
  }
  return cells;
}

/**
 * Parse weekly pesi HTML into dated table rows from `record_display` tables.
 */
export function parseWeeklyPesiHtml(html: string): ParsedPesiRow[] {
  const rows: ParsedPesiRow[] = [];
  const sections = html.split(/पेशी\s*मिति\s*:/i);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i] ?? "";
    const dateMatch = section.match(/^([^<\s]+)/);
    const pesiDate = stripHtml(dateMatch?.[1] ?? "").trim();
    if (!pesiDate) continue;

    const tableMatch = section.match(
      /class=["']record_display["'][^>]*>([\s\S]*?)<\/table>/i
    );
    if (!tableMatch?.[1]) continue;

    const tableBody = tableMatch[1];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    let isHeader = true;

    while ((trMatch = trRe.exec(tableBody))) {
      const trHtml = trMatch[1] ?? "";
      if (isHeader || /<th\b/i.test(trHtml)) {
        isHeader = false;
        continue;
      }

      const cells = extractTdCells(trHtml);
      if (cells.length < 4) continue;

      const caseNoRaw = cells[1] ?? "";
      if (!caseNoRaw || !/[०-९0-9A-Za-z]/.test(caseNoRaw)) continue;

      rows.push({
        pesiDate,
        sn: cells[0] ?? "",
        caseNoRaw,
        registrationDate: cells[2] ?? "",
        matter: cells[3] ?? "",
        parties: cells[4] ?? "",
        fantawala: cells[5] ?? "",
        signal: cells[6] ?? "",
        priority: cells[7] ?? "",
        remarks: cells[8] ?? "",
        cells,
      });
    }
  }

  return rows;
}

export async function fetchWeeklyPesiHtml(
  courtScDailyId: number
): Promise<string> {
  const url = `${SC_WEEKLY_PESI_BASE}/${courtScDailyId}`;
  const referer = `${SC_DAILY_REFERER_BASE}/${courtScDailyId}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ne,en-US;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://supremecourt.gov.np",
      Referer: referer,
      "User-Agent":
        "Mozilla/5.0 (compatible; NagarikPatra/1.0; +https://nagarikpalika.com)",
    },
    body: "pesi_bar=all&submit=%E0%A4%96%E0%A5%8B%E0%A4%9C%E0%A5%8D%E0%A4%A8%E0%A5%81+%E0%A4%B9%E0%A5%8B%E0%A4%B8%E0%A5%8D",
  });

  if (!res.ok) {
    throw new Error(
      `Supreme Court pesi request failed (${res.status} ${res.statusText})`
    );
  }

  return res.text();
}

export async function fetchCourtWeeklyPesiRows(
  courtScDailyId: number
): Promise<{ courtScDailyId: number; fetchedAt: string; rows: ParsedPesiRow[] }> {
  const html = await fetchWeeklyPesiHtml(courtScDailyId);
  return {
    courtScDailyId,
    fetchedAt: new Date().toISOString(),
    rows: parseWeeklyPesiHtml(html),
  };
}

export async function fetchAndMatchCasePesi(params: {
  courtScDailyId: number;
  caseNo: string;
}): Promise<FetchWeeklyPesiResult> {
  const { rows, fetchedAt } = await fetchCourtWeeklyPesiRows(
    params.courtScDailyId
  );
  const matchedRows = rows.filter((row) =>
    caseNoMatches(row.caseNoRaw, params.caseNo)
  );

  return {
    courtScDailyId: params.courtScDailyId,
    fetchedAt,
    totalRows: rows.length,
    matchedRows,
  };
}
