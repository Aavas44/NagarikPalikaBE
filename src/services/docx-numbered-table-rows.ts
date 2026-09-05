import PizZip from "pizzip";

export const TABLE_ROW_COUNT_KEY = "__table_row_count";
export const MAX_TABLE_ROWS = 15;

const TBL_RE = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;

function rowText(trXml: string): string {
  return trXml.replace(/<[^>]+>/g, "");
}

function dataRowNumber(trXml: string): number | null {
  const nums = [...rowText(trXml).matchAll(/_(\d+)(?!\d)/g)].map((match) =>
    Number(match[1])
  );
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

function rewriteRowSuffix(rowXml: string, from: number, to: number): string {
  const fromRe = new RegExp(`_${from}(?!\\d)`, "g");
  return rowXml.replace(fromRe, `_${to}`);
}

function scaleTable(tblXml: string, rowCount: number): string {
  const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  const rows = tblXml.match(trRe);
  if (!rows || rows.length === 0) return tblXml;

  const dataRows = rows
    .map((xml, index) => ({ xml, index, n: dataRowNumber(xml) }))
    .filter((row): row is { xml: string; index: number; n: number } => row.n != null);
  if (dataRows.length === 0) return tblXml;

  const prototype = dataRows.reduce((best, row) =>
    row.n < best.n ? row : best
  );
  const generated: string[] = [];
  for (let row = 1; row <= rowCount; row += 1) {
    generated.push(rewriteRowSuffix(prototype.xml, prototype.n, row));
  }

  const firstData = Math.min(...dataRows.map((row) => row.index));
  const lastData = Math.max(...dataRows.map((row) => row.index));
  const rebuilt = [
    ...rows.slice(0, firstData),
    ...generated,
    ...rows.slice(lastData + 1),
  ];

  trRe.lastIndex = 0;
  const firstMatch = trRe.exec(tblXml);
  if (!firstMatch) return tblXml;
  let lastEnd = firstMatch.index + firstMatch[0].length;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(tblXml))) {
    lastEnd = match.index + match[0].length;
  }
  return tblXml.slice(0, firstMatch.index) + rebuilt.join("") + tblXml.slice(lastEnd);
}

export function parseTableRowCount(values: Record<string, unknown>): number | null {
  const raw = values[TABLE_ROW_COUNT_KEY];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_TABLE_ROWS, Math.max(1, Math.floor(parsed)));
}

export function scaleNumberedTableRowsInDocx(
  buffer: Buffer,
  rowCount: number
): Buffer {
  const count = Math.min(MAX_TABLE_ROWS, Math.max(1, Math.floor(rowCount)));
  const zip = new PizZip(buffer);
  const file = zip.file("word/document.xml");
  if (!file) return buffer;
  const next = file.asText().replace(TBL_RE, (tbl) => scaleTable(tbl, count));
  zip.file("word/document.xml", next);
  return Buffer.from(zip.generate({ type: "nodebuffer" }));
}
