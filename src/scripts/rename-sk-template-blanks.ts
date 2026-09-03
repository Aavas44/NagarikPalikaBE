/**
 * One-time (or --force) rename of {blank_N} placeholders in SK DOCX templates
 * to semantic keys + Nepali/English labels via Gemini, then re-upload to R2.
 *
 * Consecutive blanks that represent ONE logical field (e.g. court district split
 * across blank_1/2/3) are merged into a single placeholder in the DOCX.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/rename-sk-template-blanks.ts --dry-run
 *   npx tsx src/scripts/rename-sk-template-blanks.ts --limit 3
 *   npx tsx src/scripts/rename-sk-template-blanks.ts --force
 *   npx tsx src/scripts/rename-sk-template-blanks.ts --slug district-official-form-1
 */
import "dotenv/config";
import PizZip from "pizzip";
import { connectDB } from "../config/db";
import {
  SajiloKanunDocumentTemplate,
  type ISkTemplateVariable,
} from "../models/SajiloKanunDocumentTemplate";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";
import {
  readSkTemplateFileBuffer,
} from "../services/sk-template-content";
import { putR2Object } from "../services/r2-storage";

type BlankContext = {
  oldKey: string;
  context: string;
};

type RenameSuggestion = {
  oldKey: string;
  newKey: string;
  labelNe: string;
  labelEn: string;
  section?: string;
};

type MergeGroup = {
  oldKeys: string[];
  newKey: string;
  labelNe: string;
  labelEn: string;
  section?: string;
};

type RenamePlan = {
  mergeGroups: MergeGroup[];
  singles: RenameSuggestion[];
};

const SEMANTIC_KEY_HINT = `Prefer keys like:
court_name, case_number, case_subject, registration_date,
plaintiff_1_name, plaintiff_1_address, plaintiff_1_father, plaintiff_1_grandfather, plaintiff_1_citizenship, plaintiff_1_age,
plaintiff_2_name, …,
defendant_1_name, defendant_1_address, defendant_1_father, defendant_1_citizenship, …
petitioner_1_name / respondent_1_name (same meaning as plaintiff/defendant),
fact_summary, claim_main, court_fee, legal_section, witness_1, evidence_1, date_bs, amount_npr.
If unclear use unknown_<n> matching the blank number. Keys must match /^[a-z][a-z0-9_]*$/.`;

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const limitIdx = argv.indexOf("--limit");
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1]
      ? Math.max(1, Number(argv[limitIdx + 1]) || 0)
      : 0;
  const slugIdx = argv.indexOf("--slug");
  const slug = slugIdx >= 0 ? argv[slugIdx + 1]?.trim() || "" : "";
  return { dryRun, force, limit, slug };
}

function stripXml(text: string): string {
  return text
    .replace(/<w:tab[^/]*\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectBlankContexts(buffer: Buffer): BlankContext[] {
  const zip = new PizZip(buffer);
  const parts: string[] = [];
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    if (fileName.includes("footer") || fileName.includes("header")) continue;
    parts.push(zip.files[fileName].asText());
  }
  const plain = stripXml(parts.join("\n"));
  const contexts: BlankContext[] = [];
  const re = /\{(blank_\d+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(plain)) !== null) {
    const oldKey = match[1].toLowerCase();
    const start = Math.max(0, match.index - 90);
    const end = Math.min(plain.length, match.index + match[0].length + 90);
    contexts.push({
      oldKey,
      context: plain.slice(start, end),
    });
  }
  // de-dupe by oldKey keeping first context
  const seen = new Set<string>();
  return contexts.filter((c) => {
    if (seen.has(c.oldKey)) return false;
    seen.add(c.oldKey);
    return true;
  });
}

function collectBlankOutline(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const parts: string[] = [];
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    if (fileName.includes("footer") || fileName.includes("header")) continue;
    parts.push(zip.files[fileName].asText());
  }
  return stripXml(parts.join("\n"));
}

function blankNumber(key: string): number {
  return Number(key.replace(/\D/g, "")) || 0;
}

function parseSuggestionRow(
  row: Record<string, unknown>,
  fallbackIndex: number
): RenameSuggestion | null {
  const oldKey =
    typeof row.oldKey === "string" ? row.oldKey.trim().toLowerCase() : "";
  if (!/^blank_\d+$/.test(oldKey)) return null;
  const n = blankNumber(oldKey) || fallbackIndex;
  const newKey = sanitizeKey(
    typeof row.newKey === "string" ? row.newKey : `unknown_${n}`,
    n
  );
  return {
    oldKey,
    newKey,
    labelNe:
      typeof row.labelNe === "string" && row.labelNe.trim()
        ? row.labelNe.trim()
        : newKey,
    labelEn:
      typeof row.labelEn === "string" && row.labelEn.trim()
        ? row.labelEn.trim()
        : newKey,
    section:
      typeof row.section === "string" ? row.section.trim().slice(0, 80) : "",
  };
}

function parseMergeGroupRow(
  row: Record<string, unknown>,
  fallbackIndex: number
): MergeGroup | null {
  const rawKeys = row.oldKeys;
  if (!Array.isArray(rawKeys) || rawKeys.length < 2) return null;
  const oldKeys = rawKeys
    .map((k) => (typeof k === "string" ? k.trim().toLowerCase() : ""))
    .filter((k) => /^blank_\d+$/.test(k));
  if (oldKeys.length < 2) return null;

  const n = blankNumber(oldKeys[0]) || fallbackIndex;
  const newKey = sanitizeKey(
    typeof row.newKey === "string" ? row.newKey : `unknown_${n}`,
    n
  );
  return {
    oldKeys,
    newKey,
    labelNe:
      typeof row.labelNe === "string" && row.labelNe.trim()
        ? row.labelNe.trim()
        : newKey,
    labelEn:
      typeof row.labelEn === "string" && row.labelEn.trim()
        ? row.labelEn.trim()
        : newKey,
    section:
      typeof row.section === "string" ? row.section.trim().slice(0, 80) : "",
  };
}

function sanitizeKey(raw: string, fallbackIndex: number): string {
  let key = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    key = `unknown_${fallbackIndex}`;
  }
  return key.slice(0, 64);
}

function resolveGeminiModel(): string {
  return (
    process.env.DOCUMENT_EXTRACTION_MODEL?.trim() ||
    process.env.GEMINI_OCR_MODEL?.trim() ||
    process.env.GEMINI_CHAT_MODEL?.trim() ||
    "gemini-3.5-flash"
  );
}

// Polyfill Symbol.dispose and Symbol.asyncDispose for older Node.js versions
if (typeof Symbol.dispose === "undefined") {
  (Symbol as any).dispose = Symbol("Symbol.dispose");
}
if (typeof Symbol.asyncDispose === "undefined") {
  (Symbol as any).asyncDispose = Symbol("Symbol.asyncDispose");
}

function extractPromptText(result: { result?: unknown }): string {
  const payload = result.result;
  if (typeof payload === "string") return payload;
  if (
    payload &&
    typeof payload === "object" &&
    "text" in payload &&
    typeof (payload as { text?: unknown }).text === "string"
  ) {
    return (payload as { text: string }).text;
  }
  return "";
}

function stripMarkdownCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function parseRenameJson(raw: string): {
  mergeGroups?: unknown;
  singles?: unknown;
  items?: unknown;
} {
  const cleaned = stripMarkdownCodeFence(raw);
  if (!cleaned) {
    throw new Error("Empty model response");
  }

  try {
    return JSON.parse(cleaned) as { items?: unknown };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error(`No JSON object found in response: ${cleaned.slice(0, 200)}`);
    }
    return JSON.parse(cleaned.slice(start, end + 1)) as { items?: unknown };
  }
}

async function callGeminiJson(prompt: string, attempt = 1): Promise<string> {
  const { Agent, JsonlLocalAgentStore } = await import("@cursor/sdk");
  const modelId = process.env.CURSOR_MODEL?.trim() || resolveGeminiModel();
  const result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: modelId },
    local: { cwd: process.cwd(), store: new JsonlLocalAgentStore(process.cwd()) },
  });
  if (result.status !== "completed" && result.status !== "finished") {
    console.error("Agent failed with status:", result.status, result);
    throw new Error(`Agent failed with status: ${result.status}`);
  }

  const text = extractPromptText(result);
  if (!text.trim()) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return callGeminiJson(prompt, attempt + 1);
    }
    throw new Error("Empty agent response");
  }

  return text;
}

async function suggestMergesAndRenames(
  blanks: BlankContext[],
  outline: string
): Promise<RenamePlan> {
  const prompt = `You label Nepali court petition DOCX placeholders for Docxtemplater.

IMPORTANT: Word often splits ONE logical input across multiple {blank_1}{blank_2}{blank_3} because of layout/underlines (e.g. court district, father name). Those MUST be one variable in mergeGroups — not separate singles.

Return JSON:
{
  "mergeGroups": [
    {
      "oldKeys": ["blank_1", "blank_2", "blank_3"],
      "newKey": "court_district",
      "labelNe": "जिल्ला अदालत",
      "labelEn": "District Court",
      "section": "court"
    },
    {
      "oldKeys": ["blank_4", "blank_5"],
      "newKey": "petitioner_1_father",
      "labelNe": "बुबा/आमाको नाम",
      "labelEn": "Father/Mother Name",
      "section": "plaintiff_1"
    }
  ],
  "singles": [
    { "oldKey": "blank_6", "newKey": "case_number", "labelNe": "...", "labelEn": "...", "section": "case" }
  ]
}

Rules:
- Every blank in the input must appear in exactly one mergeGroup OR singles.
- mergeGroups: 2+ consecutive blanks that are ONE fillable field (same sentence/label).
- singles: one blank = one field.
- newKey must be unique across the whole form. Never reuse the same newKey in multiple singles — use mergeGroups instead. ${SEMANTIC_KEY_HINT}
- Labels in Nepali (Devanagari) and short English.
- section: court | case | plaintiff_N | defendant_N | facts | claims | evidence | other

Document outline (placeholders in reading order):
${outline.slice(0, 14000)}

Blanks with local context:
${JSON.stringify(blanks, null, 2)}`;

  const raw = await callGeminiJson(prompt);
  let parsed: { mergeGroups?: unknown; singles?: unknown; items?: unknown };
  try {
    parsed = parseRenameJson(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error";
    throw new Error(`Failed to parse Gemini JSON: ${message}`);
  }

  return normalizeRenamePlan(blanks, parsed);
}

function normalizeRenamePlan(
  blanks: BlankContext[],
  parsed: { mergeGroups?: unknown; singles?: unknown; items?: unknown }
): RenamePlan {
  const mergeGroups: MergeGroup[] = [];
  const singles: RenameSuggestion[] = [];
  const assigned = new Set<string>();
  const usedNewKeys = new Set<string>();

  const mergeRows = Array.isArray(parsed.mergeGroups) ? parsed.mergeGroups : [];
  for (let i = 0; i < mergeRows.length; i++) {
    const row = mergeRows[i];
    if (!row || typeof row !== "object") continue;
    const group = parseMergeGroupRow(row as Record<string, unknown>, i + 1);
    if (!group) continue;
    if (usedNewKeys.has(group.newKey)) continue;
    const keys = group.oldKeys.filter((k) => !assigned.has(k));
    if (keys.length < 2) continue;
    group.oldKeys = keys;
    for (const key of keys) assigned.add(key);
    usedNewKeys.add(group.newKey);
    mergeGroups.push(group);
  }

  const singleRows = Array.isArray(parsed.singles)
    ? parsed.singles
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  for (let i = 0; i < singleRows.length; i++) {
    const row = singleRows[i];
    if (!row || typeof row !== "object") continue;
    const suggestion = parseSuggestionRow(row as Record<string, unknown>, i + 1);
    if (!suggestion || assigned.has(suggestion.oldKey)) continue;
    if (usedNewKeys.has(suggestion.newKey)) {
      suggestion.newKey = `unknown_${blankNumber(suggestion.oldKey)}`;
    }
    assigned.add(suggestion.oldKey);
    usedNewKeys.add(suggestion.newKey);
    singles.push(suggestion);
  }

  for (const blank of blanks) {
    if (assigned.has(blank.oldKey)) continue;
    const n = blankNumber(blank.oldKey);
    const newKey = `unknown_${n}`;
    singles.push({
      oldKey: blank.oldKey,
      newKey,
      labelNe: `खाली ठाउँ ${n}`,
      labelEn: `Blank field ${n}`,
      section: "other",
    });
    assigned.add(blank.oldKey);
    usedNewKeys.add(newKey);
  }

  return { mergeGroups, singles };
}

function assertUniquePlan(plan: RenamePlan): void {
  const keys = new Set<string>();
  for (const group of plan.mergeGroups) {
    if (keys.has(group.newKey)) {
      throw new Error(`Duplicate variable key in plan: ${group.newKey}`);
    }
    keys.add(group.newKey);
  }
  for (const single of plan.singles) {
    if (keys.has(single.newKey)) {
      throw new Error(`Duplicate variable key in plan: ${single.newKey}`);
    }
    keys.add(single.newKey);
  }
}

function ensureUniqueVariables(
  variables: ISkTemplateVariable[]
): ISkTemplateVariable[] {
  const byKey = new Map<string, ISkTemplateVariable>();
  for (const variable of variables) {
    const existing = byKey.get(variable.key);
    if (!existing) {
      byKey.set(variable.key, { ...variable });
      continue;
    }
    if (!existing.labelNe?.trim() && variable.labelNe?.trim()) {
      existing.labelNe = variable.labelNe;
    }
    if (!existing.labelEn?.trim() && variable.labelEn?.trim()) {
      existing.labelEn = variable.labelEn;
    }
    if (!existing.section?.trim() && variable.section?.trim()) {
      existing.section = variable.section;
    }
    existing.required = existing.required || variable.required;
  }
  return [...byKey.values()];
}

function applyRenamePlan(buffer: Buffer, plan: RenamePlan): Buffer {
  const zip = new PizZip(buffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    let xml = zip.files[fileName].asText();

    for (const group of plan.mergeGroups) {
      if (group.oldKeys.length === 0) continue;
      const [first, ...rest] = group.oldKeys;
      xml = xml.replace(new RegExp(`\\{${first}\\}`, "gi"), `{${group.newKey}}`);
      for (const oldKey of rest) {
        xml = xml.replace(new RegExp(`\\{${oldKey}\\}`, "gi"), "");
      }
    }

    for (const single of plan.singles) {
      xml = xml.replace(
        new RegExp(`\\{${single.oldKey}\\}`, "gi"),
        `{${single.newKey}}`
      );
    }

    zip.file(fileName, xml);
  }

  const next = Buffer.from(zip.generate({ type: "nodebuffer" }));
  const leftover = extractPlaceholdersFromDocx(next).filter((k) =>
    /^blank_\d+$/i.test(k)
  );
  if (leftover.length > 0) {
    throw new Error(`Orphan blanks remain after rewrite: ${leftover.join(", ")}`);
  }
  return next;
}

function variablesFromPlan(plan: RenamePlan): ISkTemplateVariable[] {
  const variables: ISkTemplateVariable[] = [];
  for (const group of plan.mergeGroups) {
    variables.push({
      key: group.newKey,
      labelEn: group.labelEn,
      labelNe: group.labelNe,
      type: "text",
      required: !group.newKey.startsWith("unknown_"),
      section: group.section || "",
    });
  }
  for (const single of plan.singles) {
    if (variables.some((v) => v.key === single.newKey)) continue;
    variables.push({
      key: single.newKey,
      labelEn: single.labelEn,
      labelNe: single.labelNe,
      type: "text",
      required: !single.newKey.startsWith("unknown_"),
      section: single.section || "",
    });
  }
  return variables;
}

async function processTemplate(options: {
  templateId: string;
  dryRun: boolean;
  force: boolean;
}): Promise<{
  renamed: number;
  unknown: number;
  skipped: boolean;
}> {
  const template = await SajiloKanunDocumentTemplate.findById(options.templateId);
  if (!template) throw new Error("Template not found");
  if (template.fileType !== "docx") {
    return { renamed: 0, unknown: 0, skipped: true };
  }

  const hasBlanksInDb = template.variables.some((v) => /^blank_\d+$/i.test(v.key));
  const buffer = await readSkTemplateFileBuffer(template.storageKey);
  const blanks = collectBlankContexts(buffer);
  if (blanks.length === 0) {
    return { renamed: 0, unknown: 0, skipped: true };
  }
  if (!hasBlanksInDb && !options.force) {
    // DOCX still has blanks but DB was partially updated — continue anyway.
    console.log(`  ${template.slug}: blanks in DOCX, re-processing…`);
  }

  const outline = collectBlankOutline(buffer);
  console.log(
    `  ${template.slug}: ${blanks.length} blanks — labeling + merging with Gemini…`
  );
  const plan = await suggestMergesAndRenames(blanks, outline);
  assertUniquePlan(plan);
  const variableCount = plan.mergeGroups.length + plan.singles.length;
  const unknown =
    plan.mergeGroups.filter((g) => g.newKey.startsWith("unknown_")).length +
    plan.singles.filter((s) => s.newKey.startsWith("unknown_")).length;

  if (options.dryRun) {
    console.log(
      "  dry-run merges:",
      plan.mergeGroups.map((g) => `${g.oldKeys.join("+")} → ${g.newKey}`)
    );
    console.log(
      "  dry-run singles sample:",
      plan.singles.slice(0, 5).map((s) => `${s.oldKey} → ${s.newKey}`)
    );
    return { renamed: variableCount, unknown, skipped: false };
  }

  const rewritten = applyRenamePlan(buffer, plan);

  await putR2Object({
    key: template.storageKey,
    body: rewritten,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  let variables = ensureUniqueVariables(variablesFromPlan(plan));

  // Preserve any non-blank variables that weren't in the map
  for (const existing of template.variables) {
    if (/^blank_\d+$/i.test(existing.key)) continue;
    if (variables.some((v) => v.key === existing.key)) continue;
    variables.push(existing);
  }

  variables = ensureUniqueVariables(variables);
  template.variables = variables;
  await template.save();
  return { renamed: variableCount, unknown, skipped: false };
}

async function main() {
  const { dryRun, force, limit, slug } = parseArgs(process.argv.slice(2));
  await connectDB();

  const filter: Record<string, unknown> = { status: "published", fileType: "docx" };
  if (slug) filter.slug = slug;

  let templates = await SajiloKanunDocumentTemplate.find(filter)
    .sort({ courtType: 1, documentKind: 1 })
    .select("_id slug courtType documentKind variables");

  if (!force && !slug) {
    templates = templates.filter((t) =>
      t.variables.some((v) => /^blank_\d+$/i.test(v.key))
    );
  }
  if (limit > 0) templates = templates.slice(0, limit);

  console.log(
    `Rename SK blanks: ${templates.length} templates${dryRun ? " (dry-run)" : ""}`
  );

  let processed = 0;
  let skipped = 0;
  let renamedTotal = 0;
  let unknownTotal = 0;
  let failed = 0;

  for (const template of templates) {
    try {
      const result = await processTemplate({
        templateId: template._id.toString(),
        dryRun,
        force,
      });
      if (result.skipped) {
        skipped += 1;
        continue;
      }
      processed += 1;
      renamedTotal += result.renamed;
      unknownTotal += result.unknown;
      console.log(
        `  ✓ ${template.slug}: renamed ${result.renamed} (unknown ${result.unknown})`
      );
    } catch (err) {
      failed += 1;
      console.error(
        `  ✗ ${template.slug}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    JSON.stringify(
      { processed, skipped, failed, renamedTotal, unknownTotal, dryRun },
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
