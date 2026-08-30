import path from "path";
import { randomUUID } from "crypto";
import { deleteR2Object, putR2Object } from "./r2-storage";

const MAX_TEMPLATE_BYTES = 15 * 1024 * 1024;

export function assertSkTemplateFile(fileName: string): {
  extension: ".docx" | ".pdf";
  mimeType: string;
} {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".docx") {
    return {
      extension: ".docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  if (ext === ".pdf") {
    return { extension: ".pdf", mimeType: "application/pdf" };
  }
  throw new Error("Only DOCX and PDF template files are allowed");
}

export async function storeSkTemplateFile(
  fileName: string,
  buffer: Buffer
): Promise<{ storageKey: string; fileType: "docx" | "pdf" }> {
  if (buffer.length > MAX_TEMPLATE_BYTES) {
    throw new Error("Template file must be 15 MB or smaller");
  }
  const { extension, mimeType } = assertSkTemplateFile(fileName);
  const storageKey = `sajilo-kanun-templates/${randomUUID()}${extension}`;
  await putR2Object({ key: storageKey, body: buffer, contentType: mimeType });
  return {
    storageKey,
    fileType: extension === ".pdf" ? "pdf" : "docx",
  };
}

export async function removeSkTemplateFile(storageKey: string): Promise<void> {
  if (!storageKey?.trim()) return;
  try {
    await deleteR2Object(storageKey);
  } catch {
    // best-effort cleanup
  }
}
