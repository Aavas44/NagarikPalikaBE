/**
 * Replace district-court SK templates in MongoDB/R2 with updated DOCX files.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/replace-district-templates-from-folder.ts
 *   npx tsx src/scripts/replace-district-templates-from-folder.ts --dry-run
 *   npx tsx src/scripts/replace-district-templates-from-folder.ts --dir "/Users/seva/Downloads/templates_updated"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { SajiloKanunDocumentTemplate } from "../models/SajiloKanunDocumentTemplate";
import {
  removeSkTemplateFile,
  storeSkTemplateFile,
} from "../services/sk-template-storage";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import { mergeTemplateVariables } from "../services/ward-variable-presets";

const DEFAULT_DIR = "/Users/seva/Downloads/templates_updated";
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const dirIdx = argv.indexOf("--dir");
  const dir =
    dirIdx >= 0 && argv[dirIdx + 1]?.trim()
      ? argv[dirIdx + 1].trim()
      : DEFAULT_DIR;
  return { dryRun, dir };
}

function toAsciiDigits(value: string): string {
  return value.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

/** Extract form number from names like "फाराम न १० ..." or "फाराम न ७३- ..." */
function extractFormNumber(fileName: string): number | null {
  const stem = fileName.replace(/\.docx$/i, "");
  const match = stem.match(/फाराम\s*न\s*[.\-]?\s*([०-९0-9]+)/i);
  if (!match) return null;
  const n = Number(toAsciiDigits(match[1]));
  return Number.isFinite(n) ? n : null;
}

function documentKindForForm(formNumber: number): string {
  return `district_official_form_${formNumber}`;
}

async function main() {
  const { dryRun, dir } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();

  const byKind = new Map<string, { fileName: string; fullPath: string; formNumber: number }>();
  const unparsed: string[] = [];

  for (const fileName of files) {
    const formNumber = extractFormNumber(fileName);
    if (formNumber == null) {
      unparsed.push(fileName);
      continue;
    }
    const kind = documentKindForForm(formNumber);
    if (byKind.has(kind)) {
      console.warn(
        `WARN: duplicate form ${formNumber}: keeping ${byKind.get(kind)!.fileName}, skipping ${fileName}`
      );
      continue;
    }
    byKind.set(kind, {
      fileName,
      fullPath: path.join(dir, fileName),
      formNumber,
    });
  }

  await connectDB();

  const districtTemplates = await SajiloKanunDocumentTemplate.find({
    courtType: "district",
  });

  let updated = 0;
  let missingFile = 0;
  let failed = 0;
  const missingKinds: string[] = [];

  for (const template of districtTemplates) {
    const source = byKind.get(template.documentKind);
    if (!source) {
      missingFile += 1;
      missingKinds.push(template.documentKind);
      console.log(
        `SKIP (no local file): ${template.documentKind} — ${template.nameNe || template.nameEn}`
      );
      continue;
    }

    try {
      const buffer = fs.readFileSync(source.fullPath);
      const detected = extractPlaceholdersFromDocx(buffer);
      const variables = mergeTemplateVariables([], detected);

      if (dryRun) {
        console.log(
          `[dry-run] would update ${template.documentKind} ← ${source.fileName} (${detected.length} vars)`
        );
        updated += 1;
        byKind.delete(template.documentKind);
        continue;
      }

      const oldKey = template.storageKey;
      const stored = await storeSkTemplateFile(source.fileName, buffer);
      template.storageKey = stored.storageKey;
      template.fileType = stored.fileType;
      template.originalFileName = source.fileName;
      template.variables = variables;
      template.status = "published";
      await template.save();
      await removeSkTemplateFile(oldKey);

      updated += 1;
      byKind.delete(template.documentKind);
      console.log(
        `updated ${template.documentKind} ← ${source.fileName} (${detected.length} vars)`
      );
    } catch (err) {
      failed += 1;
      console.error(
        `FAIL ${template.documentKind}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const unusedLocal = [...byKind.values()];
  console.log(
    JSON.stringify(
      {
        dryRun,
        localFiles: files.length,
        unparsedLocal: unparsed,
        districtInDb: districtTemplates.length,
        updated,
        missingFileForDbTemplate: missingFile,
        missingKinds,
        unusedLocalFiles: unusedLocal.map((u) => u.fileName),
        failed,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
