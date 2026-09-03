/**
 * Persist restored paragraph alignment (w:jc) for SK DOCX templates missing it.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/restore-sk-template-alignment.ts --dry-run
 *   npx tsx src/scripts/restore-sk-template-alignment.ts
 *   npx tsx src/scripts/restore-sk-template-alignment.ts --slug district-district-official-form-1
 */
import "dotenv/config";
import { connectDB } from "../config/db";
import { SajiloKanunDocumentTemplate } from "../models/SajiloKanunDocumentTemplate";
import {
  docxHasParagraphAlignment,
  restoreCourtFormAlignment,
} from "../services/sk-docx-alignment";
import { getR2Object, putR2Object } from "../services/r2-storage";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const slugIdx = argv.indexOf("--slug");
  const slug = slugIdx >= 0 ? argv[slugIdx + 1]?.trim() || "" : "";
  return { dryRun, slug };
}

async function main() {
  const { dryRun, slug } = parseArgs(process.argv.slice(2));
  await connectDB();

  const filter: Record<string, unknown> = {
    status: "published",
    fileType: "docx",
  };
  if (slug) filter.slug = slug;

  const templates = await SajiloKanunDocumentTemplate.find(filter)
    .select("_id slug nameNe storageKey")
    .lean();

  let alreadyOk = 0;
  let restored = 0;
  let failed = 0;

  for (const template of templates) {
    try {
      const original = await getR2Object(template.storageKey);
      if (docxHasParagraphAlignment(original)) {
        alreadyOk += 1;
        continue;
      }

      const fixed = restoreCourtFormAlignment(original);
      if (docxHasParagraphAlignment(fixed)) {
        if (!dryRun) {
          await putR2Object({
            key: template.storageKey,
            body: fixed,
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
        }
        restored += 1;
        console.log(
          `${dryRun ? "[dry-run] would restore" : "restored"}: ${template.slug}`
        );
      } else {
        alreadyOk += 1;
      }
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
        alreadyOk,
        restored,
        failed,
      },
      null,
      2
    )
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
