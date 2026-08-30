import JSZip from "jszip";
import {
  readCaseUploadFile,
  sanitizeFileName,
} from "./case-uploads";
import type { ICaseUploadedDocument } from "../models/CaseUploadedDocument";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function plaintextToDocxBuffer(text: string): Promise<Buffer> {
  const HTMLtoDOCX = (await import("html-to-docx")).default;
  const body = text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("");
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="font-family: 'Noto Sans Devanagari', 'Mangal', sans-serif; font-size: 14pt; line-height: 1.6;">${body}</body></html>`;
  const docxResult = await HTMLtoDOCX(wrapped, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  return Buffer.isBuffer(docxResult)
    ? docxResult
    : Buffer.from(docxResult as ArrayBuffer);
}

export function generatedDraftFileName(title: string): string {
  const base = sanitizeFileName(title.trim() || "draft").replace(/\.docx$/i, "");
  return `${base}.docx`;
}

function uniqueZipName(used: Set<string>, fileName: string): string {
  const safe = fileName.replace(/[\\/]+/g, "_").trim() || "document";
  if (!used.has(safe.toLowerCase())) {
    used.add(safe.toLowerCase());
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let i = 2;
  let next = `${stem}-${i}${ext}`;
  while (used.has(next.toLowerCase())) {
    i += 1;
    next = `${stem}-${i}${ext}`;
  }
  used.add(next.toLowerCase());
  return next;
}

export async function zipCaseUploads(params: {
  teamId: string;
  caseId: string;
  uploads: ICaseUploadedDocument[];
}): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Set<string>();

  for (const doc of params.uploads) {
    const buffer = await readCaseUploadFile({
      storageKey: doc.storageKey,
      teamId: params.teamId,
      caseId: params.caseId,
    });
    const name = uniqueZipName(used, doc.fileName || "document");
    zip.file(name, buffer);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function asciiZipFileName(caseNo: string): string {
  const raw = `case-${caseNo || "files"}-files.zip`;
  return (
    raw
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[.\s_]+|[.\s_]+$/g, "") || "case-files.zip"
  );
}
