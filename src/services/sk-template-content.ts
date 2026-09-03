import { getR2Object, putR2Object } from "./r2-storage";
import { restoreCourtFormAlignment } from "./sk-docx-alignment";
import { extractPlaceholdersFromDocx } from "./ward-docx-placeholders";
import {
  mergeTemplateVariables,
  normalizeVariableKey,
} from "./ward-variable-presets";
import type { ISkTemplateVariable } from "../models/SajiloKanunDocumentTemplate";

function htmlWithPreservedAlignment(htmlContent: string): string {
  return htmlContent
    .replace(
      /<p([^>]*)\bclass="([^"]*\btext-center\b[^"]*)"([^>]*)>/gi,
      '<p$1class="$2" style="text-align: center"$3>'
    )
    .replace(
      /<p([^>]*)\bclass="([^"]*\btext-right\b[^"]*)"([^>]*)>/gi,
      '<p$1class="$2" style="text-align: right"$3>'
    )
    .replace(
      /<p([^>]*)\bclass="([^"]*\btext-justify\b[^"]*)"([^>]*)>/gi,
      '<p$1class="$2" style="text-align: justify"$3>'
    );
}

export async function htmlContentToDocxBuffer(htmlContent: string): Promise<Buffer> {
  const HTMLtoDOCX = (await import("html-to-docx")).default;
  const alignedHtml = htmlWithPreservedAlignment(htmlContent);
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="font-family: 'Noto Sans Devanagari', 'Mangal', sans-serif; font-size: 14pt; line-height: 1.6;">${alignedHtml}</body></html>`;
  const docxResult = await HTMLtoDOCX(wrapped, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  return Buffer.isBuffer(docxResult)
    ? docxResult
    : Buffer.from(docxResult as ArrayBuffer);
}

export function refreshSkTemplateVariablesFromDocx(
  existing: ISkTemplateVariable[],
  buffer: Buffer
): ISkTemplateVariable[] {
  const detectedKeys = extractPlaceholdersFromDocx(buffer);
  const detectedNormalized = new Set(
    detectedKeys.map((key) => normalizeVariableKey(key))
  );
  const manual = existing.filter((variable) =>
    detectedNormalized.has(normalizeVariableKey(variable.key))
  );
  return mergeTemplateVariables(manual, detectedKeys);
}

export async function overwriteSkTemplateDocxFromHtml(
  storageKey: string,
  htmlContent: string
): Promise<Buffer> {
  const buffer = await htmlContentToDocxBuffer(htmlContent);
  const alignedBuffer = restoreCourtFormAlignment(buffer);
  await putR2Object({
    key: storageKey,
    body: alignedBuffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return alignedBuffer;
}

export async function readSkTemplateFileBuffer(storageKey: string): Promise<Buffer> {
  const buffer = await getR2Object(storageKey);
  return restoreCourtFormAlignment(buffer);
}
