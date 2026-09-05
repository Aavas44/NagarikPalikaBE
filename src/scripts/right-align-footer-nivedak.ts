/**
 * Right-align footer signature block on all published SK DOCX templates:
 *   निवेदक
 *   {निवेदकको_नाम}
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/right-align-footer-nivedak.ts --dry-run
 *   npx tsx src/scripts/right-align-footer-nivedak.ts
 *   npx tsx src/scripts/right-align-footer-nivedak.ts --court high
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { SajiloKanunDocumentTemplate } from "../models/SajiloKanunDocumentTemplate";
import { rightAlignFooterNivedak } from "../services/sk-docx-alignment";
import { getR2Object, putR2Object } from "../services/r2-storage";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const courtIdx = argv.indexOf("--court");
  const court =
    courtIdx >= 0 && argv[courtIdx + 1] ? argv[courtIdx + 1].trim() : "";
  return { dryRun, court };
}

async function main() {
  const { dryRun, court } = parseArgs(process.argv.slice(2));
  await connectDB();

  const filter: Record<string, unknown> = {
    status: "published",
    fileType: "docx",
  };
  if (court) filter.courtType = court;

  const templates = await SajiloKanunDocumentTemplate.find(filter)
    .select("_id slug courtType documentKind nameNe storageKey")
    .lean();

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const template of templates) {
    try {
      const original = await getR2Object(template.storageKey);
      const fixed = rightAlignFooterNivedak(original);
      if (Buffer.compare(original, fixed) === 0) {
        unchanged += 1;
        continue;
      }
      if (!dryRun) {
        await putR2Object({
          key: template.storageKey,
          body: fixed,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      }
      changed += 1;
      console.log(
        `${dryRun ? "[dry-run] would update" : "updated"}: ${template.courtType}/${template.documentKind}`
      );
    } catch (err) {
      failed += 1;
      console.error(
        `FAIL ${template.slug}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        total: templates.length,
        changed,
        unchanged,
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
