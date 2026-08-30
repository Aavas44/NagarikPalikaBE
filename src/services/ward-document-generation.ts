import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { getR2Object } from "./r2-storage";
import type { IWardDocumentTemplate } from "../models/WardDocumentTemplate";
import type { IWardOperatorProfile } from "../models/WardOperatorProfile";
import { extractPlaceholdersFromDocx } from "./ward-docx-placeholders";
import { buildWardProfileVariables } from "./ward-profile-variables";
import {
  buildUserFieldsFromPlaceholders,
  expandMergedVariables,
  isAutoFilledVariableKey,
} from "./ward-variable-presets";

export type WardGenerationVariables = Record<string, string | number>;

function profileToVariables(
  profile: IWardOperatorProfile
): WardGenerationVariables {
  return buildWardProfileVariables(profile);
}

function sanitizeMergedValues(
  values: WardGenerationVariables,
  placeholderKeys: string[]
): Record<string, string> {
  const expanded = expandMergedVariables(values, placeholderKeys);
  for (const key of placeholderKeys) {
    if (expanded[key] === undefined) {
      expanded[key] = "";
    }
  }
  return expanded;
}

function validateRequiredVariables(
  template: IWardDocumentTemplate,
  placeholderKeys: string[],
  values: Record<string, string>
): void {
  const userFields = buildUserFieldsFromPlaceholders(
    placeholderKeys,
    template.variables
  );
  const missing: string[] = [];
  for (const variable of userFields) {
    if (!variable.required) continue;
    const val = values[variable.key];
    if (!val?.trim()) {
      missing.push(variable.labelNe || variable.labelEn || variable.key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Please fill required fields: ${missing.join(", ")}`);
  }
}

export async function getTemplatePlaceholderKeys(
  template: IWardDocumentTemplate
): Promise<string[]> {
  const templateBuffer = await getR2Object(template.storageKey);
  return extractPlaceholdersFromDocx(templateBuffer);
}

export async function getTemplateFormFields(template: IWardDocumentTemplate) {
  const placeholderKeys = await getTemplatePlaceholderKeys(template);
  const userFields = buildUserFieldsFromPlaceholders(
    placeholderKeys,
    template.variables
  );
  return {
    placeholderKeys,
    userFields: userFields.map((field) => ({
      key: field.key,
      label: { en: field.labelEn, ne: field.labelNe || field.labelEn },
      type: field.type,
      required: field.required,
    })),
    autoFieldKeys: placeholderKeys.filter((key) => isAutoFilledVariableKey(key)),
  };
}

export async function generateWardDocument(
  template: IWardDocumentTemplate,
  profile: IWardOperatorProfile,
  inputValues: WardGenerationVariables
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const templateBuffer = await getR2Object(template.storageKey);
  const placeholderKeys = extractPlaceholdersFromDocx(templateBuffer);

  const merged = sanitizeMergedValues(
    {
      ...profileToVariables(profile),
      ...inputValues,
    },
    placeholderKeys
  );
  validateRequiredVariables(template, placeholderKeys, merged);

  if (template.fileType === "docx") {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
    doc.render(merged);
    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const baseName = template.originalFileName.replace(/\.docx$/i, "");
    return {
      buffer,
      fileName: `${baseName}-filled.docx`,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  throw new Error(
    "PDF template fill is not supported yet. Upload a DOCX template with placeholders like {operator_name}."
  );
}
