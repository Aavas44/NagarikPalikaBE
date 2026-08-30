/**
 * Import processed Supreme Court petition forms into SajiloKanunDocumentTemplate.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/import-sc-forms.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import {
  SajiloKanunDocumentTemplate,
} from "../models/SajiloKanunDocumentTemplate";
import { storeSkTemplateFile } from "../services/sk-template-storage";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import { mergeTemplateVariables } from "../services/ward-variable-presets";
import type { ISkTemplateVariable } from "../models/SajiloKanunDocumentTemplate";
import type { CourtType } from "../lib/court-type";
import { buildTemplateNameRoman } from "../lib/nepali-romanize";

type ManifestEntry = {
  courtType: CourtType;
  documentKind: string;
  nameNe: string;
  nameEn: string;
  originalFileName: string;
  processedPath: string;
  variables: ISkTemplateVariable[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function main() {
  const manifestPath = path.resolve(
    process.cwd(),
    "../tmp/sc-forms/processed/manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Missing ${manifestPath}. Run process-sc-forms.py first.`
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  ) as ManifestEntry[];

  await connectDB();

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const entry of manifest) {
    try {
      const buffer = fs.readFileSync(entry.processedPath);
      const stored = await storeSkTemplateFile(entry.originalFileName, buffer);
      const detected = extractPlaceholdersFromDocx(buffer);
      const variables = mergeTemplateVariables(
        entry.variables ?? [],
        detected
      );

      const baseSlug =
        slugify(`${entry.courtType}-${entry.documentKind}`) ||
        `sk-${Date.now()}`;
      let slug = baseSlug;

      const existing = await SajiloKanunDocumentTemplate.findOne({
        courtType: entry.courtType,
        documentKind: entry.documentKind,
      });

      if (existing) {
        // replace file + metadata
        const { removeSkTemplateFile } = await import(
          "../services/sk-template-storage"
        );
        await removeSkTemplateFile(existing.storageKey);
        existing.nameEn = entry.nameEn;
        existing.nameNe = entry.nameNe;
        existing.nameRoman = buildTemplateNameRoman(entry.nameNe, entry.nameEn);
        existing.descriptionEn = `Official petition form — ${entry.courtType}`;
        existing.descriptionNe = `आधिकारिक निवेदन ढाँचा — ${entry.nameNe}`;
        existing.variables = variables;
        existing.fileType = stored.fileType;
        existing.storageKey = stored.storageKey;
        existing.originalFileName = entry.originalFileName;
        existing.status = "published";
        await existing.save();
        updated += 1;
        console.log(`updated ${entry.courtType}/${entry.documentKind}`);
      } else {
        let suffix = 1;
        while (await SajiloKanunDocumentTemplate.exists({ slug })) {
          slug = `${baseSlug}-${suffix++}`;
        }
        await SajiloKanunDocumentTemplate.create({
          slug,
          nameEn: entry.nameEn,
          nameNe: entry.nameNe,
          nameRoman: buildTemplateNameRoman(entry.nameNe, entry.nameEn),
          descriptionEn: `Official petition form — ${entry.courtType}`,
          descriptionNe: `आधिकारिक निवेदन ढाँचा — ${entry.nameNe}`,
          courtType: entry.courtType,
          documentKind: entry.documentKind,
          variables,
          fileType: stored.fileType,
          storageKey: stored.storageKey,
          originalFileName: entry.originalFileName,
          status: "published",
        });
        created += 1;
        console.log(`created ${entry.courtType}/${entry.documentKind}`);
      }
    } catch (err) {
      failed += 1;
      console.error(
        `FAIL ${entry.courtType}/${entry.documentKind}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    JSON.stringify({ created, updated, failed, total: manifest.length }, null, 2)
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
