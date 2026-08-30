import { getR2Object, putR2Object } from "./r2-storage";
import { extractPlaceholdersFromDocx } from "./ward-docx-placeholders";
import {
  mergeTemplateVariables,
  normalizeVariableKey,
} from "./ward-variable-presets";
import type { IWardTemplateVariable } from "../models/WardDocumentTemplate";

export async function htmlContentToDocxBuffer(htmlContent: string): Promise<Buffer> {
  const HTMLtoDOCX = (await import("html-to-docx")).default;
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body style="font-family: 'Noto Sans Devanagari', 'Mangal', sans-serif; font-size: 14pt; line-height: 1.6;">${htmlContent}</body></html>`;
  const docxResult = await HTMLtoDOCX(wrapped, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });
  return Buffer.isBuffer(docxResult)
    ? docxResult
    : Buffer.from(docxResult as ArrayBuffer);
}

export function refreshTemplateVariablesFromDocx(
  existing: IWardTemplateVariable[],
  buffer: Buffer
): IWardTemplateVariable[] {
  const detectedKeys = extractPlaceholdersFromDocx(buffer);
  const detectedNormalized = new Set(
    detectedKeys.map((key) => normalizeVariableKey(key))
  );
  const manual = existing.filter((variable) =>
    detectedNormalized.has(normalizeVariableKey(variable.key))
  );
  return mergeTemplateVariables(manual, detectedKeys);
}

export async function overwriteWardTemplateDocxFromHtml(
  storageKey: string,
  htmlContent: string
): Promise<Buffer> {
  const buffer = await htmlContentToDocxBuffer(htmlContent);
  await putR2Object({
    key: storageKey,
    body: buffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return buffer;
}

export async function readWardTemplateFileBuffer(storageKey: string): Promise<Buffer> {
  return getR2Object(storageKey);
}
