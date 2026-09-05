/**
 * Import ward application templates from extracted ODT JSON
 * (tmp/woda-templates.json produced from the Woda Karyalaya ODT pack).
 *
 * - Header titles become template names; header line itself is omitted from body
 * - मिति right-aligned; विषय centered (not flush left); body justified; footer right
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/import-ward-odt-templates.ts --dry-run
 *   npx tsx src/scripts/import-ward-odt-templates.ts
 *   npx tsx src/scripts/import-ward-odt-templates.ts --replace
 *   npx tsx src/scripts/import-ward-odt-templates.ts --replace --only "नाता प्रमाणित निवेदन"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { connectDB } from "../config/db";
import {
  WardDocumentTemplate,
  type IWardTemplateVariable,
} from "../models/WardDocumentTemplate";
import {
  removeWardTemplateFile,
  storeWardTemplateFile,
} from "../services/ward-template-storage";
import { htmlContentToDocxBuffer } from "../services/ward-template-content";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import { mergeTemplateVariables } from "../services/ward-variable-presets";

type TableBlock = { headers: string[]; rows: string[][] };
type Para = { align: string | null; text: string; table?: TableBlock };
type JsonTemplate = { header: string; name: string; paras: Para[] };

const NAME_EN: Record<string, string> = {
  "नाता प्रमाणित निवेदन": "Nata Pramanit Nivedan",
  "आयस्रोत प्रमाणित निवेदन": "Income Source Certificate Application",
  "जग्गा मूल्यांकन निवेदन": "Land Valuation Application",
  "कर चुक्ता प्रमाणपत्र / सिफारिस निवेदन": "Tax Clearance Recommendation Application",
  "बाटो कायम / प्रमाणित निवेदन": "Road Access Certificate Application",
  "घर सम्पन्न (भवन निर्माण सम्पन्न) सिफारिस निवेदन":
    "Building Completion Recommendation Application",
  "घर कायम सिफारिस निवेदन": "House Registration Recommendation Application",
  "अविवाहित प्रमाणित निवेदन": "Unmarried Certificate Application",
  "जन्ममिति फरक परेको प्रमाणित निवेदन": "Birth Date Mismatch Certificate Application",
  "व्यवसाय नवीकरण सिफारिस निवेदन": "Business Renewal Recommendation Application",
  "छात्रवृत्तिका लागि सिफारिस निवेदन": "Scholarship Recommendation Application",
  "अस्थायी बसोबास प्रमाणित निवेदन": "Temporary Residence Certificate Application",
  "खानेपानीको धारा जडान सिफारिस निवेदन": "Water Connection Recommendation Application",
  "गाई मरेको बिमा दाबी सिफारिस निवेदन": "Cattle Insurance Claim Recommendation Application",
  "सवारी नामसारी प्रमाणित सिफारिस निवेदन": "Vehicle Transfer Recommendation Application",
  "चेकबुक / भत्ता / पेन्सन उपलब्धिका लागि सिफारिस निवेदन":
    "Chequebook Allowance Pension Recommendation Application",
  "मृतकको खाताको रकम / शेयर नामसारी निवेदन":
    "Deceased Account Share Transfer Application",
  "लालपुर्जा हराएको सिफारिस (प्रतिलिपिका लागि) निवेदन":
    "Lost Land Title Copy Recommendation Application",
};

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const replace = argv.includes("--replace");
  const jsonIdx = argv.indexOf("--json");
  const onlyIdx = argv.indexOf("--only");
  const jsonPath =
    jsonIdx >= 0 && argv[jsonIdx + 1]
      ? path.resolve(argv[jsonIdx + 1])
      : path.resolve(__dirname, "../../../tmp/woda-templates.json");
  const onlyRaw =
    onlyIdx >= 0 && argv[onlyIdx + 1] ? argv[onlyIdx + 1].trim() : "";
  const only = onlyRaw
    ? onlyRaw.split(",").map((part) => part.trim()).filter(Boolean)
    : [];
  return { dryRun, replace, jsonPath, only };
}

function slugifyEn(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function classifyAlign(text: string, sourceAlign: string | null): string {
  const t = text.trim();
  if (/^मिति\s*[:：]/u.test(t)) return "right";
  if (/^विषय\s*[:：]/u.test(t)) return "center";
  if (sourceAlign === "end" || sourceAlign === "right") return "right";
  if (sourceAlign === "center") return "center";
  if (sourceAlign === "justify" || t.length >= 80) return "justify";
  return "left";
}

function paraToHtml(text: string, align: string): string {
  const lines = text.split(/\n/).map((l) => l.trimEnd());
  if (
    lines.length > 1 &&
    (/^निवेदक/u.test(lines[0].trim()) || align === "right")
  ) {
    return lines
      .filter((l) => l.trim().length > 0)
      .map(
        (l) =>
          `<p class="text-right" style="text-align: right; margin: 0.15em 0;">${escapeHtml(
            l.trim()
          )}</p>`
      )
      .join("\n");
  }

  const cls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : align === "justify"
          ? "text-justify"
          : "text-left";
  const style =
    align === "right"
      ? "text-align: right;"
      : align === "center"
        ? "text-align: center;"
        : align === "justify"
          ? "text-align: justify;"
          : "text-align: left;";
  // विषय: centered with side margins so it is not flush-left
  const margin =
    align === "center" && /^विषय/u.test(text.trim())
      ? "margin: 0.85em 2.5em;"
      : align === "right"
        ? "margin: 0 0 0.75em 0;"
        : "margin: 0.35em 0;";
  return `<p class="${cls}" style="${style} ${margin}">${escapeHtml(text)}</p>`;
}

function tableToHtml(table: TableBlock): string {
  const headerCells = table.headers
    .map((cell) => `<td><b>${escapeHtml(cell)}</b></td>`)
    .join("");
  const bodyRows = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`
    )
    .join("\n");
  return `<table border="1" width="100%" cellpadding="6" cellspacing="0">
<tr>${headerCells}</tr>
${bodyRows}
</table>`;
}

function templateToHtml(paras: Para[]): string {
  const parts: string[] = [];
  for (const p of paras) {
    if (p.table) {
      parts.push(tableToHtml(p.table));
      continue;
    }
    const text = (p.text || "").trim();
    if (!text) {
      parts.push('<p style="margin: 0.4em 0;">&nbsp;</p>');
      continue;
    }
    parts.push(paraToHtml(text, classifyAlign(text, p.align)));
  }
  return parts.join("\n");
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base || `template-${Date.now()}`;
  let suffix = 1;
  while (await WardDocumentTemplate.exists({ slug })) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

async function main() {
  const { dryRun, replace, jsonPath, only } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON not found: ${jsonPath}`);
  }

  const templates = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as JsonTemplate[];
  console.log(`Loaded ${templates.length} templates from ${jsonPath}`);

  const outDir = path.resolve(__dirname, "../../../tmp/ward-odt-docx");
  fs.mkdirSync(outDir, { recursive: true });

  await connectDB();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of templates) {
    const nameNe = t.name.trim();
    if (
      only.length > 0 &&
      !only.some((name) => nameNe === name || nameNe.includes(name))
    ) {
      continue;
    }
    const nameEn = NAME_EN[nameNe] || nameNe;
    const slugBase = slugifyEn(nameEn) || `ward-app-${created + updated + 1}`;
    const html = templateToHtml(t.paras || []);
    const buffer = await htmlContentToDocxBuffer(html);
    const fileName = `${slugBase}.docx`;
    const localPath = path.join(outDir, fileName);
    fs.writeFileSync(localPath, buffer);

    const keys = extractPlaceholdersFromDocx(buffer);
    const variables: IWardTemplateVariable[] = mergeTemplateVariables([], keys);

    console.log(
      `\n${nameNe}\n  en=${nameEn}\n  placeholders=${keys.length} bytes=${buffer.length}\n  file=${localPath}`
    );

    if (dryRun) {
      skipped++;
      continue;
    }

    const existing = await WardDocumentTemplate.findOne({
      $or: [{ nameNe }, { slug: slugBase }],
    });

    if (existing && !replace) {
      console.log(`  skip existing ${existing._id} (use --replace)`);
      skipped++;
      continue;
    }

    const stored = await storeWardTemplateFile(fileName, buffer);

    if (existing && replace) {
      const oldKey = existing.storageKey;
      existing.nameEn = nameEn;
      existing.nameNe = nameNe;
      existing.variables = variables;
      existing.fileType = stored.fileType;
      existing.storageKey = stored.storageKey;
      existing.originalFileName = fileName;
      existing.status = "published";
      await existing.save();
      if (oldKey && oldKey !== stored.storageKey) {
        await removeWardTemplateFile(oldKey).catch(() => undefined);
      }
      updated++;
      console.log(`  updated ${existing._id}`);
    } else {
      const slug = await uniqueSlug(slugBase);
      const doc = await WardDocumentTemplate.create({
        slug,
        nameEn,
        nameNe,
        descriptionEn: "",
        descriptionNe: "",
        variables,
        fileType: stored.fileType,
        storageKey: stored.storageKey,
        originalFileName: fileName,
        status: "published",
      });
      created++;
      console.log(`  created ${doc._id} slug=${slug}`);
    }
  }

  console.log(
    `\nDone. created=${created} updated=${updated} skipped=${skipped} dryRun=${dryRun}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
