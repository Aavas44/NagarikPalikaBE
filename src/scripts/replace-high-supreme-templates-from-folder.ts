/**
 * Replace High / Supreme Court SK templates in MongoDB/R2 from finalized DOCX folder.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/replace-high-supreme-templates-from-folder.ts
 *   npx tsx src/scripts/replace-high-supreme-templates-from-folder.ts --dry-run
 *   npx tsx src/scripts/replace-high-supreme-templates-from-folder.ts --court high
 *   npx tsx src/scripts/replace-high-supreme-templates-from-folder.ts --dir tmp/sc-forms/finalized
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
import type { ISkTemplateVariable } from "../models/SajiloKanunDocumentTemplate";
import type { CourtType } from "../lib/court-type";
import { buildTemplateNameRoman } from "../lib/nepali-romanize";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_DIR = path.join(REPO_ROOT, "tmp/sc-forms/finalized");
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

type VarMeta = {
  key: string;
  labelNe?: string;
  labelEn?: string;
  section?: string;
};

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const dirIdx = argv.indexOf("--dir");
  const dir =
    dirIdx >= 0 && argv[dirIdx + 1]?.trim()
      ? path.resolve(argv[dirIdx + 1].trim())
      : DEFAULT_DIR;
  const courtIdx = argv.indexOf("--court");
  const courtRaw =
    courtIdx >= 0 && argv[courtIdx + 1] ? argv[courtIdx + 1].trim() : "";
  const courts: CourtType[] =
    courtRaw === "high" || courtRaw === "supreme"
      ? [courtRaw]
      : ["high", "supreme"];
  return { dryRun, dir, courts };
}

function toAsciiDigits(value: string): string {
  return value.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function extractFormNumber(fileName: string): number | null {
  const stem = fileName.replace(/\.docx$/i, "");
  const match = stem.match(/फाराम\s*न[ं.]?\s*[.\-]?\s*([०-९0-9]+)/i);
  if (!match) return null;
  const n = Number(toAsciiDigits(match[1]));
  return Number.isFinite(n) ? n : null;
}

function documentKindFor(court: CourtType, formNumber: number): string {
  return `${court}_official_form_${formNumber}`;
}

/** Legacy/odd documentKind values already in DB. */
const KIND_ALIASES: Record<string, string> = {
  supreme_official_form: "supreme_official_form_51",
  supreme_official_nibedan_52: "supreme_official_form_52",
};

function resolveSourceKind(
  templateKind: string,
  byKind: Map<string, { fileName: string; fullPath: string; formNumber: number }>
): { fileName: string; fullPath: string; formNumber: number } | undefined {
  const direct = byKind.get(templateKind);
  if (direct) return direct;
  const aliased = KIND_ALIASES[templateKind];
  if (aliased) return byKind.get(aliased);
  return undefined;
}

function loadVarsMeta(docxPath: string): VarMeta[] {
  const metaPath = docxPath.replace(/\.docx$/i, ".vars.json");
  if (!fs.existsSync(metaPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      variables?: VarMeta[];
    };
    return Array.isArray(raw.variables) ? raw.variables : [];
  } catch {
    return [];
  }
}

async function replaceCourt(
  courtType: CourtType,
  dir: string,
  dryRun: boolean
) {
  const courtDir = path.join(dir, courtType);
  if (!fs.existsSync(courtDir)) {
    console.log(`SKIP court dir missing: ${courtDir}`);
    return;
  }

  const files = fs
    .readdirSync(courtDir)
    .filter((f) => f.toLowerCase().endsWith(".docx"))
    .sort();

  const byKind = new Map<
    string,
    { fileName: string; fullPath: string; formNumber: number }
  >();
  const unparsed: string[] = [];

  for (const fileName of files) {
    const formNumber = extractFormNumber(fileName);
    if (formNumber == null) {
      unparsed.push(fileName);
      continue;
    }
    const kind = documentKindFor(courtType, formNumber);
    if (byKind.has(kind)) {
      console.warn(
        `WARN: duplicate form ${formNumber}: keeping ${byKind.get(kind)!.fileName}, skipping ${fileName}`
      );
      continue;
    }
    byKind.set(kind, {
      fileName,
      fullPath: path.join(courtDir, fileName),
      formNumber,
    });
  }

  const templates = await SajiloKanunDocumentTemplate.find({ courtType });
  let updated = 0;
  let missingFile = 0;
  let failed = 0;
  const missingKinds: string[] = [];

  for (const template of templates) {
    const source = resolveSourceKind(template.documentKind, byKind);
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
      const meta = loadVarsMeta(source.fullPath);
      const metaByKey = new Map(
        meta.map((v) => [v.key, v] as const).filter(([k]) => Boolean(k))
      );
      let variables: ISkTemplateVariable[] = mergeTemplateVariables(
        [],
        detected
      );
      variables = variables.map((v) => {
        const m = metaByKey.get(v.key);
        if (!m) return v;
        return {
          ...v,
          labelNe: m.labelNe?.trim() || v.labelNe,
          labelEn: m.labelEn?.trim() || v.labelEn,
          section: m.section?.trim() || "",
        };
      });

      // Prefer canonical kind when updating a legacy alias
      const canonicalKind = documentKindFor(courtType, source.formNumber);
      if (template.documentKind !== canonicalKind) {
        console.log(
          `normalize kind ${template.documentKind} → ${canonicalKind}`
        );
        template.documentKind = canonicalKind;
      }

      if (dryRun) {
        console.log(
          `[dry-run] would update ${template.documentKind} ← ${source.fileName} (${detected.length} vars)`
        );
        updated += 1;
        byKind.delete(canonicalKind);
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
      byKind.delete(canonicalKind);
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

  // Create any local forms that are not yet in DB (e.g. supreme form 42)
  let created = 0;
  for (const [kind, source] of byKind) {
    try {
      const buffer = fs.readFileSync(source.fullPath);
      const detected = extractPlaceholdersFromDocx(buffer);
      const meta = loadVarsMeta(source.fullPath);
      const metaByKey = new Map(
        meta.map((v) => [v.key, v] as const).filter(([k]) => Boolean(k))
      );
      let variables: ISkTemplateVariable[] = mergeTemplateVariables(
        [],
        detected
      );
      variables = variables.map((v) => {
        const m = metaByKey.get(v.key);
        if (!m) return v;
        return {
          ...v,
          labelNe: m.labelNe?.trim() || v.labelNe,
          labelEn: m.labelEn?.trim() || v.labelEn,
          section: m.section?.trim() || "",
        };
      });
      const nameNe = source.fileName
        .replace(/\.docx$/i, "")
        .replace(/^फाराम\s*न[ं.]?\s*[.\-]?\s*[०-९0-9]+\s*/i, "")
        .trim();

      if (dryRun) {
        console.log(
          `[dry-run] would create ${kind} ← ${source.fileName} (${detected.length} vars)`
        );
        created += 1;
        continue;
      }

      const stored = await storeSkTemplateFile(source.fileName, buffer);
      let slug = `${courtType}-official-form-${source.formNumber}`;
      let suffix = 1;
      while (await SajiloKanunDocumentTemplate.exists({ slug })) {
        slug = `${courtType}-official-form-${source.formNumber}-${suffix++}`;
      }
      await SajiloKanunDocumentTemplate.create({
        courtType,
        documentKind: kind,
        nameNe,
        nameEn: nameNe,
        nameRoman: buildTemplateNameRoman(nameNe, nameNe),
        descriptionEn: `Official petition form — ${courtType}`,
        descriptionNe: `आधिकारिक निवेदन ढाँचा — ${nameNe}`,
        slug,
        storageKey: stored.storageKey,
        fileType: stored.fileType,
        originalFileName: source.fileName,
        variables,
        status: "published",
      });
      created += 1;
      console.log(
        `created ${kind} ← ${source.fileName} (${detected.length} vars)`
      );
    } catch (err) {
      failed += 1;
      console.error(
        `FAIL create ${kind}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        courtType,
        dryRun,
        localFiles: files.length,
        unparsedLocal: unparsed,
        inDb: templates.length,
        updated,
        created,
        missingFileForDbTemplate: missingFile,
        missingKinds,
        failed,
      },
      null,
      2
    )
  );

  return failed;
}

async function main() {
  const { dryRun, dir, courts } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  await connectDB();
  let failed = 0;
  for (const court of courts) {
    failed += (await replaceCourt(court, dir, dryRun)) || 0;
  }
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
