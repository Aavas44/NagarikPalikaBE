import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { ISajiloKanunDocumentTemplate } from "../models/SajiloKanunDocumentTemplate";
import { extractPlaceholdersFromDocx } from "./ward-docx-placeholders";
import { readSkTemplateFileBuffer } from "./sk-template-content";

export type SkGenerationVariables = Record<string, string | number>;

const SK_FIELD_START = "\uE000";
const SK_FIELD_MID = "\uE001";
const SK_FIELD_END_START = "\uE002";
const SK_FIELD_END = "\uE003";

function wrapPreviewField(key: string, display: string): string {
  return `${SK_FIELD_START}${key}${SK_FIELD_MID}${display}${SK_FIELD_END_START}${key}${SK_FIELD_END}`;
}

function previewDisplayForField(
  template: ISajiloKanunDocumentTemplate,
  key: string,
  value: string
): string {
  if (value.trim()) return value;
  const meta = template.variables.find((v) => v.key === key);
  return meta?.labelNe || meta?.labelEn || key;
}

function sanitizeValues(
  placeholderKeys: string[],
  inputValues: SkGenerationVariables
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of placeholderKeys) {
    const raw = inputValues[key];
    out[key] =
      raw === undefined || raw === null ? "" : String(raw).trim();
  }
  return out;
}

function validateRequiredVariables(
  template: ISajiloKanunDocumentTemplate,
  values: Record<string, string>
): void {
  const missing: string[] = [];
  for (const variable of template.variables) {
    if (!variable.required) continue;
    // Official SC forms mark every blank as required; treat generic blanks as optional.
    if (/^blank_\d+$/i.test(variable.key)) continue;
    if (/^unknown_\d+$/i.test(variable.key)) continue;
    if (!values[variable.key]?.trim()) {
      missing.push(
        variable.labelNe || variable.labelEn || variable.key
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(`Please fill required fields: ${missing.join(", ")}`);
  }
}

export async function getSkTemplateFormFields(
  template: ISajiloKanunDocumentTemplate
) {
  if (template.fileType !== "docx") {
    throw new Error("Only DOCX templates can be filled");
  }
  const buffer = await readSkTemplateFileBuffer(template.storageKey);
  const placeholderKeys = extractPlaceholdersFromDocx(buffer);
  const byKey = new Map(template.variables.map((v) => [v.key, v]));

  const userFields = placeholderKeys.map((key) => {
    const meta = byKey.get(key);
    const isBlank = /^blank_\d+$/i.test(key);
    const isUnknown = /^unknown_\d+$/i.test(key);
    return {
      key,
      label: {
        en: meta?.labelEn || key,
        ne: meta?.labelNe || meta?.labelEn || key,
      },
      type: (meta?.type ?? "text") as "text" | "date" | "number",
      required: isBlank || isUnknown ? false : (meta?.required ?? false),
      section: meta?.section || "",
    };
  });

  // Include template variables that may not be detected in DOCX yet
  for (const variable of template.variables) {
    if (placeholderKeys.includes(variable.key)) continue;
    userFields.push({
      key: variable.key,
      label: {
        en: variable.labelEn || variable.key,
        ne: variable.labelNe || variable.labelEn || variable.key,
      },
      type: variable.type,
      required:
        /^blank_\d+$/i.test(variable.key) || /^unknown_\d+$/i.test(variable.key)
          ? false
          : variable.required,
      section: variable.section || "",
    });
  }

  return {
    placeholderKeys,
    userFields,
  };
}

export async function generateSkDocument(
  template: ISajiloKanunDocumentTemplate,
  inputValues: SkGenerationVariables,
  options?: { validateRequired?: boolean; forPreview?: boolean }
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  if (template.fileType !== "docx") {
    throw new Error(
      "PDF template fill is not supported yet. Use a DOCX template."
    );
  }

  const templateBuffer = await readSkTemplateFileBuffer(template.storageKey);
  const placeholderKeys = extractPlaceholdersFromDocx(templateBuffer);
  const merged = sanitizeValues(placeholderKeys, inputValues);

  if (options?.forPreview) {
    for (const key of placeholderKeys) {
      merged[key] = wrapPreviewField(
        key,
        previewDisplayForField(template, key, merged[key])
      );
    }
  }

  if (options?.validateRequired !== false) {
    validateRequiredVariables(template, merged);
  }

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(merged);
  const buffer = doc.getZip().generate({ type: "nodebuffer" });

  const baseName = (
    template.nameNe ||
    template.nameEn ||
    template.originalFileName.replace(/\.docx$/i, "")
  )
    .replace(/[\\/:*?"<>|\r\n]+/g, "")
    .trim()
    .slice(0, 120);

  return {
    buffer,
    fileName: `${baseName || template.slug || "document"}-filled.docx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}
