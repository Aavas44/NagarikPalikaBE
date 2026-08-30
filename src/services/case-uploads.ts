import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  deleteR2Object,
  getR2Object,
  isR2Configured,
  putR2Object,
} from "./r2-storage";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "case-files");

/** Case file uploads: documents + common images for extractor / evidence. */
export const CASE_UPLOAD_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
] as const;

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const ALLOWED_MIME_TYPES = new Set([
  ...Object.values(EXTENSION_TO_MIME),
  "text/plain; charset=utf-8",
  "application/octet-stream", // only accepted when extension is already allowed
]);

export function getCaseUploadMaxBytes() {
  return MAX_UPLOAD_BYTES;
}

export function getCaseUploadAcceptAttribute() {
  return CASE_UPLOAD_ALLOWED_EXTENSIONS.join(",");
}

export function assertAllowedCaseDocument(fileName: string, mimeType?: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (
    !CASE_UPLOAD_ALLOWED_EXTENSIONS.includes(
      ext as (typeof CASE_UPLOAD_ALLOWED_EXTENSIONS)[number]
    )
  ) {
    throw new Error(
      "Only document or image files are allowed (PDF, DOC, DOCX, TXT, RTF, ODT, XLS, XLSX, CSV, PPT, PPTX, PNG, JPG, WEBP, GIF)"
    );
  }

  const normalizedMime = (mimeType ?? "").trim().toLowerCase();
  if (
    normalizedMime &&
    normalizedMime !== "application/octet-stream" &&
    !ALLOWED_MIME_TYPES.has(normalizedMime) &&
    !normalizedMime.startsWith("text/plain") &&
    !normalizedMime.startsWith("image/")
  ) {
    throw new Error(
      "Only document or image files are allowed (PDF, DOC, DOCX, TXT, RTF, ODT, XLS, XLSX, CSV, PPT, PPTX, PNG, JPG, WEBP, GIF)"
    );
  }

  return {
    extension: ext,
    mimeType: EXTENSION_TO_MIME[ext] || normalizedMime || "application/octet-stream",
  };
}

/**
 * Object key layout (firm + case isolation):
 *   firms/{teamId}/cases/{caseId}/{uuid}-{fileName}
 */
export function buildCaseUploadStorageKey(params: {
  teamId: string;
  caseId: string;
  fileName: string;
}): string {
  const objectName = `${randomUUID()}-${params.fileName}`;
  return `firms/${params.teamId}/cases/${params.caseId}/${objectName}`;
}

export function assertStorageKeyBelongsToCase(params: {
  storageKey: string;
  teamId: string;
  caseId: string;
}): void {
  const key = params.storageKey.replace(/\\/g, "/");
  if (key.includes("..") || key.startsWith("/")) {
    throw new Error("Invalid file path");
  }
  const modernPrefix = `firms/${params.teamId}/cases/${params.caseId}/`;
  const legacyPrefix = `${params.caseId}/`;
  if (key.startsWith(modernPrefix) || key.startsWith(legacyPrefix)) {
    return;
  }
  throw new Error("Invalid file path");
}

function decodeBase64File(base64Data: string): Buffer {
  const raw = base64Data.includes(",")
    ? base64Data.split(",").pop() ?? ""
    : base64Data;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) {
    throw new Error("Uploaded file is empty");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 10 MB limit");
  }
  return buffer;
}

export function sanitizeFileName(fileName: string): string {
  const safeName = fileName
    .replace(/[^\w.\-()\s\u0900-\u097F]/g, "_")
    .slice(0, 180)
    .trim();
  if (!safeName) {
    throw new Error("A valid file name is required");
  }
  return safeName;
}

/** Rename display name only; storage key is unchanged. Extension must stay the same. */
export function normalizeCaseUploadRename(
  nextFileName: string,
  currentFileName: string
): string {
  const currentExt = path.extname(currentFileName).toLowerCase();
  // Strip any path segments from user input.
  let base = path.basename(nextFileName.trim().replace(/\\/g, "/"));
  if (!base || base === "." || base === "..") {
    throw new Error("A valid file name is required");
  }

  const nextExt = path.extname(base).toLowerCase();
  if (!nextExt) {
    base = `${base}${currentExt}`;
  } else if (nextExt !== currentExt) {
    throw new Error(
      currentExt
        ? `Keep the original file extension (${currentExt})`
        : "Invalid file name"
    );
  }

  const safe = sanitizeFileName(base);
  assertAllowedCaseDocument(safe);
  return safe;
}

async function saveLocalFile(storageKey: string, buffer: Buffer): Promise<void> {
  const absolute = path.join(LOCAL_UPLOAD_ROOT, storageKey);
  const normalizedRoot = path.resolve(LOCAL_UPLOAD_ROOT);
  const normalizedFile = path.resolve(absolute);
  if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Invalid file path");
  }
  await fs.mkdir(path.dirname(normalizedFile), { recursive: true });
  await fs.writeFile(normalizedFile, buffer);
}

async function readLocalFile(storageKey: string): Promise<Buffer> {
  const absolute = path.join(LOCAL_UPLOAD_ROOT, storageKey);
  const normalizedRoot = path.resolve(LOCAL_UPLOAD_ROOT);
  const normalizedFile = path.resolve(absolute);
  if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Invalid file path");
  }
  return fs.readFile(normalizedFile);
}

async function deleteLocalFile(storageKey: string): Promise<void> {
  const absolute = path.join(LOCAL_UPLOAD_ROOT, storageKey);
  const normalizedRoot = path.resolve(LOCAL_UPLOAD_ROOT);
  const normalizedFile = path.resolve(absolute);
  if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Invalid file path");
  }
  await fs.unlink(normalizedFile).catch(() => undefined);
}

export async function saveCaseUploadFile(params: {
  teamId: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<{ storageKey: string; size: number; fileName: string; mimeType: string }> {
  if (!params.teamId?.trim() || !params.caseId?.trim()) {
    throw new Error("Firm and case are required for uploads");
  }

  const buffer = decodeBase64File(params.base64Data);
  const safeName = sanitizeFileName(params.fileName);
  const allowed = assertAllowedCaseDocument(safeName, params.mimeType);
  const storageKey = buildCaseUploadStorageKey({
    teamId: params.teamId,
    caseId: params.caseId,
    fileName: safeName,
  });

  if (isR2Configured()) {
    await putR2Object({
      key: storageKey,
      body: buffer,
      contentType: allowed.mimeType,
    });
  } else {
    await saveLocalFile(storageKey, buffer);
  }

  return {
    storageKey,
    size: buffer.length,
    fileName: safeName,
    mimeType: allowed.mimeType,
  };
}

export async function saveCaseUploadBuffer(params: {
  teamId: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ storageKey: string; size: number; fileName: string; mimeType: string }> {
  if (!params.teamId?.trim() || !params.caseId?.trim()) {
    throw new Error("Firm and case are required for uploads");
  }
  if (!params.buffer.length) {
    throw new Error("File content is empty");
  }
  if (params.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 10 MB limit");
  }

  const safeName = sanitizeFileName(params.fileName);
  const allowed = assertAllowedCaseDocument(safeName, params.mimeType);
  const storageKey = buildCaseUploadStorageKey({
    teamId: params.teamId,
    caseId: params.caseId,
    fileName: safeName,
  });

  if (isR2Configured()) {
    await putR2Object({
      key: storageKey,
      body: params.buffer,
      contentType: allowed.mimeType,
    });
  } else {
    await saveLocalFile(storageKey, params.buffer);
  }

  return {
    storageKey,
    size: params.buffer.length,
    fileName: safeName,
    mimeType: allowed.mimeType,
  };
}

/** Extensions that support in-app edit + overwrite (single R2 put on save). */
export type CaseUploadEditableKind = "txt" | "docx";

export function getCaseUploadEditableKind(
  fileName: string,
  mimeType?: string
): CaseUploadEditableKind | null {
  const ext = path.extname(fileName).toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === ".txt" || mime.startsWith("text/plain")) return "txt";
  if (
    ext === ".docx" ||
    mime.includes("wordprocessingml") ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

/**
 * Overwrite an existing object in place (same storage key) to avoid delete+put.
 * Used by the document editor Save action.
 */
export async function overwriteCaseUploadFile(params: {
  storageKey: string;
  teamId: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ size: number; mimeType: string }> {
  assertStorageKeyBelongsToCase(params);
  const allowed = assertAllowedCaseDocument(params.fileName, params.mimeType);
  if (params.buffer.length < 1) {
    throw new Error("File content is empty");
  }
  if (params.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (max ${MAX_UPLOAD_BYTES} bytes)`);
  }

  if (isR2Configured()) {
    await putR2Object({
      key: params.storageKey,
      body: params.buffer,
      contentType: allowed.mimeType,
    });
  } else {
    await saveLocalFile(params.storageKey, params.buffer);
  }

  return { size: params.buffer.length, mimeType: allowed.mimeType };
}

export async function readCaseUploadFile(params: {
  storageKey: string;
  teamId: string;
  caseId: string;
}): Promise<Buffer> {
  assertStorageKeyBelongsToCase(params);
  if (isR2Configured()) {
    return getR2Object(params.storageKey);
  }
  return readLocalFile(params.storageKey);
}

export async function deleteCaseUploadFile(params: {
  storageKey: string;
  teamId: string;
  caseId: string;
}): Promise<void> {
  assertStorageKeyBelongsToCase(params);
  if (isR2Configured()) {
    await deleteR2Object(params.storageKey);
    return;
  }
  await deleteLocalFile(params.storageKey);
}

/** True when Cloudflare R2 env is present (otherwise local disk fallback). */
export function caseUploadsUseR2(): boolean {
  return isR2Configured();
}
