/**
 * Backfill nameRoman on all Sajilo Kanun document templates.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/backfill-sk-template-name-roman.ts
 */
import "dotenv/config";
import { connectDB } from "../config/db";
import { SajiloKanunDocumentTemplate } from "../models/SajiloKanunDocumentTemplate";
import { buildTemplateNameRoman } from "../lib/nepali-romanize";

async function main() {
  await connectDB();
  const templates = await SajiloKanunDocumentTemplate.find();
  let updated = 0;
  for (const template of templates) {
    const next = buildTemplateNameRoman(template.nameNe, template.nameEn);
    if (template.nameRoman === next) continue;
    template.nameRoman = next;
    await template.save();
    updated += 1;
    console.log(`${template.courtType}/${template.documentKind} → ${next}`);
  }
  console.log(JSON.stringify({ total: templates.length, updated }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
