/**
 * Finalize High + Supreme Court SK templates from processed blank_N DOCX:
 * 1) Gemini rename/merge blanks → clear Nepali keys (district style)
 * 2) Polish: grammar, leading empty paras, evidence vars, court headers, bottom निवेदक
 * 3) Write to tmp/sc-forms/finalized/{high,supreme}/फाराम न N ….docx
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/finalize-high-supreme-templates.ts
 *   npx tsx src/scripts/finalize-high-supreme-templates.ts --limit 2
 *   npx tsx src/scripts/finalize-high-supreme-templates.ts --court high
 *   npx tsx src/scripts/finalize-high-supreme-templates.ts --force
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { GoogleGenAI } from "@google/genai";
import { extractPlaceholdersFromDocx } from "../services/ward-docx-placeholders";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PROCESSED = path.join(REPO_ROOT, "tmp/sc-forms/processed");
const FINALIZED = path.join(REPO_ROOT, "tmp/sc-forms/finalized");
const MANIFEST = path.join(
  REPO_ROOT,
  "tmp/sc-forms/processed/manifest-high-supreme.json"
);

const DEV_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"] as const;

type BlankContext = { oldKey: string; context: string };
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
type RenamePlan = { mergeGroups: MergeGroup[]; singles: RenameSuggestion[] };

type ManifestEntry = {
  courtType: "high" | "supreme";
  documentKind: string;
  nameNe: string;
  originalFileName: string;
  processedPath: string;
};

function parseArgs(argv: string[]) {
  const force = argv.includes("--force");
  const limitIdx = argv.indexOf("--limit");
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1]
      ? Math.max(1, Number(argv[limitIdx + 1]) || 0)
      : 0;
  const courtIdx = argv.indexOf("--court");
  const court =
    courtIdx >= 0 && argv[courtIdx + 1]
      ? (argv[courtIdx + 1].trim() as "high" | "supreme" | "")
      : "";
  const modeIdx = argv.indexOf("--mode");
  const modeRaw =
    modeIdx >= 0 && argv[modeIdx + 1] ? argv[modeIdx + 1].trim() : "auto";
  const mode: "auto" | "rules" | "gemini" =
    modeRaw === "rules" || modeRaw === "gemini" || modeRaw === "auto"
      ? modeRaw
      : "auto";
  return { force, limit, court, mode };
}

function evidenceVar(n: number): string {
  const digit = DEV_DIGITS[n] ?? String(n);
  return `{संलग्न_कागज_प्रमाण_${digit}}`;
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

function paragraphPlainText(paragraphXml: string): string {
  return stripXml(paragraphXml);
}

function rewriteParagraphText(paragraphXml: string, newText: string): string {
  const pPrMatch = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i);
  const pPr = pPrMatch ? pPrMatch[0] : "";
  const openMatch = paragraphXml.match(/^<w:p\b[^>]*>/i);
  const open = openMatch ? openMatch[0] : "<w:p>";
  const escaped = newText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `${open}${pPr}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

function collectBlankContexts(buffer: Buffer): BlankContext[] {
  const zip = new PizZip(buffer);
  const xml = zip.files["word/document.xml"]?.asText() || "";
  const plain = stripXml(xml);
  const contexts: BlankContext[] = [];
  const re = /\{(blank_\d+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(plain)) !== null) {
    const oldKey = match[1].toLowerCase();
    const start = Math.max(0, match.index - 90);
    const end = Math.min(plain.length, match.index + match[0].length + 90);
    contexts.push({ oldKey, context: plain.slice(start, end) });
  }
  const seen = new Set<string>();
  return contexts.filter((c) => {
    if (seen.has(c.oldKey)) return false;
    seen.add(c.oldKey);
    return true;
  });
}

function collectBlankOutline(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  return stripXml(zip.files["word/document.xml"]?.asText() || "");
}

function blankNumber(key: string): number {
  return Number(key.replace(/\D/g, "")) || 0;
}

function sanitizeNepaliKey(raw: string, fallbackIndex: number): string {
  let key = raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\u0900-\u097F0-9a-zA-Z_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!key || /^blank_/i.test(key)) {
    key = `विवरण_भर्नुहोस्_${fallbackIndex}`;
  }
  // Prefer Devanagari; allow latin only as last resort unknown
  if (!/[\u0900-\u097F]/.test(key) && !/^[a-z][a-z0-9_]*$/i.test(key)) {
    key = `विवरण_भर्नुहोस्_${fallbackIndex}`;
  }
  return key.slice(0, 80);
}

function loadGemini(): GoogleGenAI {
  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (!apiKey) {
    // Try frontend .env.local
    const envPath = path.join(REPO_ROOT, "frontend/.env.local");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^\s*GEMINI_API_KEY(?:_FALLBACK)?\s*=\s*(.+)\s*$/);
        if (m?.[1]) {
          const v = m[1].trim().replace(/^["']|["']$/g, "");
          if (v) return new GoogleGenAI({ apiKey: v });
        }
      }
    }
    throw new Error("GEMINI_API_KEY is required for blank renaming");
  }
  return new GoogleGenAI({ apiKey });
}

function resolveModel(): string {
  return (
    process.env.DOCUMENT_EXTRACTION_MODEL?.trim() ||
    process.env.GEMINI_CHAT_MODEL?.trim() ||
    "gemini-2.5-flash"
  );
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
} {
  const cleaned = stripMarkdownCodeFence(raw);
  try {
    return JSON.parse(cleaned) as { mergeGroups?: unknown; singles?: unknown };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error(`No JSON object found: ${cleaned.slice(0, 200)}`);
    }
    return JSON.parse(cleaned.slice(start, end + 1)) as {
      mergeGroups?: unknown;
      singles?: unknown;
    };
  }
}

async function callGeminiJson(
  client: GoogleGenAI,
  prompt: string,
  attempt = 1
): Promise<string> {
  const model = resolveModel();
  try {
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: { temperature: 0.1 },
    });
    const text =
      typeof response.text === "string"
        ? response.text
        : Array.isArray(response.candidates)
          ? String(
              (
                response.candidates[0] as {
                  content?: { parts?: Array<{ text?: string }> };
                }
              )?.content?.parts?.[0]?.text || ""
            )
          : "";
    if (!text.trim()) {
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
        return callGeminiJson(client, prompt, attempt + 1);
      }
      throw new Error("Empty Gemini response");
    }
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable =
      /503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|high demand|try again/i.test(
        message
      );
    if (retryable && attempt < 6) {
      const waitMs = Math.min(30000, 3000 * attempt * attempt);
      console.warn(
        `  retry ${attempt}/6 after ${waitMs}ms (${message.slice(0, 80)})`
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return callGeminiJson(client, prompt, attempt + 1);
    }
    throw err;
  }
}

function labelPair(key: string, en: string): { labelNe: string; labelEn: string } {
  return { labelNe: key.replace(/_/g, " "), labelEn: en };
}

function toDevDigit(n: number): string {
  if (n >= 1 && n <= 9) return DEV_DIGITS[n];
  return String(n)
    .split("")
    .map((d) => DEV_DIGITS[Number(d)] ?? d)
    .join("");
}

/**
 * Deterministic rename for SC petition forms (shared skeleton across most forms).
 * Use when Gemini quota is exhausted.
 */
function buildRuleBasedPlan(
  blanks: BlankContext[],
  outline: string,
  courtType: "high" | "supreme"
): RenamePlan {
  const ordered = [...blanks].sort(
    (a, b) => blankNumber(a.oldKey) - blankNumber(b.oldKey)
  );
  const assigned = new Set<string>();
  const used = new Set<string>();
  const mergeGroups: MergeGroup[] = [];
  const singles: RenameSuggestion[] = [];

  const take = (
    oldKeys: string[],
    newKey: string,
    en: string,
    section: string
  ) => {
    const keys = oldKeys.filter((k) => !assigned.has(k));
    if (keys.length === 0) return;
    let key = newKey;
    if (used.has(key)) key = `${key}_${blankNumber(keys[0])}`;
    used.add(key);
    for (const k of keys) assigned.add(k);
    const labels = labelPair(key, en);
    if (keys.length === 1) {
      singles.push({
        oldKey: keys[0],
        newKey: key,
        ...labels,
        section,
      });
    } else {
      mergeGroups.push({
        oldKeys: keys,
        newKey: key,
        ...labels,
        section,
      });
    }
  };

  const tokenRe = /\{(blank_\d+)\}/gi;
  const tokens: Array<{ key: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(outline)) !== null) {
    tokens.push({ key: m[1].toLowerCase(), index: m.index });
  }

  const around = (key: string, before = 50, after = 50): string => {
    const hit = tokens.find((t) => t.key === key);
    if (!hit) return "";
    return outline.slice(
      Math.max(0, hit.index - before),
      Math.min(outline.length, hit.index + key.length + 4 + after)
    );
  };

  if (courtType === "high") {
    const courtBlank = ordered.find((b) =>
      /उच्च\s*अदालत\s*\{blank_/i.test(around(b.oldKey, 30, 10))
    );
    if (courtBlank) {
      take([courtBlank.oldKey], "उच्च_अदालतको_नाम", "High Court name", "court");
    }
  }

  const nivedakEnd = outline.search(/१\s*निवेदक|निवेदक\s*विरु/);
  const vipakshiEnd = outline.search(/१\s*विपक्षी|विपक्षी\s*मुद्दा/);
  const petitionerKeys = tokens
    .filter((t) => nivedakEnd >= 0 && t.index < nivedakEnd && !assigned.has(t.key))
    .map((t) => t.key);
  const defendantKeys = tokens
    .filter(
      (t) =>
        nivedakEnd >= 0 &&
        vipakshiEnd >= 0 &&
        t.index >= nivedakEnd &&
        t.index < vipakshiEnd &&
        !assigned.has(t.key)
    )
    .map((t) => t.key);

  const assignPartyBlock = (
    keys: string[],
    prefix: "निवेदक" | "विपक्षी",
    section: string
  ) => {
    if (keys.length === 0) return;
    const remaining = [...keys];
    const shift = () => remaining.shift();

    const father = remaining.find((k) => /को\s*छोरा/.test(around(k, 5, 15)));
    if (father) {
      take([father], `${prefix}को_बाबुको_नाम`, `${prefix} father name`, section);
      remaining.splice(remaining.indexOf(father), 1);
    } else if (remaining.length) {
      take(
        [shift()!],
        `${prefix}को_बाबुको_नाम`,
        `${prefix} father name`,
        section
      );
    }

    const jilla = remaining.find((k) => /जिल्ला/.test(around(k, 20, 20)));
    if (jilla) {
      take([jilla], `${prefix}को_जिल्ला`, `${prefix} district`, section);
      remaining.splice(remaining.indexOf(jilla), 1);
    }

    const wardIdx = remaining.findIndex((k) =>
      /वडा\s*नं/.test(around(k, 25, 15))
    );
    if (wardIdx > 0) {
      const muni = remaining.splice(0, wardIdx);
      take(
        muni,
        `${prefix}को_गाउँपालिका_वा_नगरपालिका`,
        `${prefix} municipality`,
        section
      );
    } else if (remaining.length > 3) {
      const muni = remaining.splice(0, Math.min(3, remaining.length - 3));
      if (muni.length) {
        take(
          muni,
          `${prefix}को_गाउँपालिका_वा_नगरपालिका`,
          `${prefix} municipality`,
          section
        );
      }
    }

    if (remaining.length) {
      const ward = remaining.find((k) => /वडा\s*नं/.test(around(k, 25, 15)));
      if (ward) {
        take([ward], `${prefix}को_वडा_नं`, `${prefix} ward no.`, section);
        remaining.splice(remaining.indexOf(ward), 1);
      } else {
        take([shift()!], `${prefix}को_वडा_नं`, `${prefix} ward no.`, section);
      }
    }

    if (remaining.length) {
      const age = remaining.find((k) => /वर्ष|उमेर/.test(around(k, 20, 15)));
      if (age) {
        take([age], `${prefix}को_उमेर`, `${prefix} age`, section);
        remaining.splice(remaining.indexOf(age), 1);
      } else {
        take([shift()!], `${prefix}को_उमेर`, `${prefix} age`, section);
      }
    }

    if (remaining.length) {
      take(remaining, `${prefix}को_नाम`, `${prefix} name`, section);
    }
  };

  assignPartyBlock(petitionerKeys, "निवेदक", "plaintiff_1");
  assignPartyBlock(defendantKeys, "विपक्षी", "defendant_1");

  for (const b of ordered) {
    if (assigned.has(b.oldKey)) continue;
    const ctx = around(b.oldKey, 30, 20);
    if (/मुद्दा\s*[-–]/.test(ctx) || /मुद्दाको\s*नाम/.test(ctx)) {
      take([b.oldKey], "मुद्दाको_नाम", "Case name", "case");
    }
  }

  const dateKeys = ordered
    .filter((b) => !assigned.has(b.oldKey))
    .filter((b) =>
      /संवत्|साल|महिना|गते|रोज|शुभम्/.test(around(b.oldKey, 40, 40))
    );
  if (dateKeys.length >= 3) {
    const keys = dateKeys.map((b) => b.oldKey);
    take([keys[0]], "साल", "Year (BS)", "other");
    take([keys[1]], "महिना", "Month (BS)", "other");
    take([keys[2]], "गते", "Day (BS)", "other");
    const rest = keys.slice(3);
    if (rest[0] && /रोज/.test(around(rest[0], 20, 20))) {
      take([rest[0]], "रोज", "Weekday", "other");
      rest.shift();
    }
    if (rest[0]) {
      take(
        [rest[0]],
        "निवेदकको_दस्तखत_नाम",
        "Petitioner signature name",
        "other"
      );
    }
    for (const k of rest.slice(1)) {
      take([k], `विवरण_भर्नुहोस्_${blankNumber(k)}`, "Fill details", "other");
    }
  }

  for (const b of ordered) {
    if (assigned.has(b.oldKey)) continue;
    const ctx = around(b.oldKey, 45, 35);
    if (/वडा\s*नं/.test(ctx)) {
      take([b.oldKey], `वडा_नं_${blankNumber(b.oldKey)}`, "Ward no.", "other");
    } else if (/जिल्ला/.test(ctx)) {
      take([b.oldKey], `जिल्ला_${blankNumber(b.oldKey)}`, "District", "other");
    } else if (/गाउँ\/?टोल|टोल/.test(ctx)) {
      take([b.oldKey], `टोल_${blankNumber(b.oldKey)}`, "Tole", "other");
    } else if (/घर\s*नं/.test(ctx)) {
      take([b.oldKey], `घर_नं_${blankNumber(b.oldKey)}`, "House no.", "other");
    } else if (/न\.?\s*पा|गा\.?\s*पा/.test(ctx)) {
      take(
        [b.oldKey],
        `नगरपालिका_वा_गाउँपालिका_${blankNumber(b.oldKey)}`,
        "Municipality",
        "other"
      );
    } else if (/मिति/.test(ctx)) {
      take([b.oldKey], `मिति_${blankNumber(b.oldKey)}`, "Date", "other");
    } else if (/रकम|रु\.|धरौट|शुल्क|जरिवाना/.test(ctx)) {
      take([b.oldKey], `रकम_${blankNumber(b.oldKey)}`, "Amount", "other");
    } else if (/निवेदक/.test(ctx) && /\{blank_/.test(ctx)) {
      take([b.oldKey], "निवेदकको_नाम", "Petitioner name", "other");
    } else if (/कागजात|प्रमाण|परिचय/.test(ctx)) {
      take(
        [b.oldKey],
        `संलग्न_कागज_प्रमाण_${toDevDigit(Math.min(blankNumber(b.oldKey), 9) || 1)}`,
        "Attached evidence",
        "evidence"
      );
    } else {
      take(
        [b.oldKey],
        `विवरण_भर्नुहोस्_${blankNumber(b.oldKey)}`,
        "Fill details",
        "other"
      );
    }
  }

  return { mergeGroups, singles };
}

async function suggestMergesAndRenames(
  client: GoogleGenAI,
  blanks: BlankContext[],
  outline: string,
  courtType: "high" | "supreme"
): Promise<RenamePlan> {
  const courtHint =
    courtType === "high"
      ? "Court header blanks → उच्च_अदालतको_नाम (merge split blanks)."
      : "Supreme Court is usually fixed (सर्वोच्च अदालत, काठमाडौँ); avoid inventing a court-name blank unless present.";

  const prompt = `You label Nepali court petition DOCX placeholders for a fillable form UI.

IMPORTANT: Word often splits ONE logical input across multiple {blank_1}{blank_2}{blank_3}. Those MUST be one variable in mergeGroups.

Return ONLY JSON:
{
  "mergeGroups": [
    {
      "oldKeys": ["blank_1", "blank_2"],
      "newKey": "उच्च_अदालतको_नाम",
      "labelNe": "उच्च अदालतको नाम",
      "labelEn": "High Court name",
      "section": "court"
    }
  ],
  "singles": [
    {
      "oldKey": "blank_3",
      "newKey": "मुद्दा_नं",
      "labelNe": "मुद्दा नं.",
      "labelEn": "Case number",
      "section": "case"
    }
  ]
}

Rules:
- Every blank must appear in exactly one mergeGroup OR singles.
- newKey MUST be clear Nepali (Devanagari) snake_case like district templates:
  उच्च_अदालतको_नाम, निवेदकको_नाम, निवेदकको_बाबुको_नाम, निवेदकको_बाजेको_नाम,
  जिल्ला, नगरपालिका_वा_गाउँपालिका, वडा_नं, उमेर, विपक्षीको_नाम,
  विपक्षीको_बाबुको_नाम, मुद्दा_नं, मुद्दा_र_नं, मुद्दाको_किसिम, विषय,
  संलग्न_कागज_प्रमाण_१, साल, महिना, गते, मिति, रकम, विवरण_भर्नुहोस्
- newKey unique across the form. Prefer mergeGroups over duplicate singles.
- Labels: short Nepali + English for the form UI.
- section: court | case | plaintiff_N | defendant_N | facts | claims | evidence | other
- ${courtHint}
- Prefer names that a citizen/lawyer immediately understands when filling the form.

Document outline:
${outline.slice(0, 14000)}

Blanks with local context:
${JSON.stringify(blanks, null, 2)}`;

  const raw = await callGeminiJson(client, prompt);
  const parsed = parseRenameJson(raw);
  return normalizeRenamePlan(blanks, parsed);
}

function normalizeRenamePlan(
  blanks: BlankContext[],
  parsed: { mergeGroups?: unknown; singles?: unknown }
): RenamePlan {
  const mergeGroups: MergeGroup[] = [];
  const singles: RenameSuggestion[] = [];
  const assigned = new Set<string>();
  const usedNewKeys = new Set<string>();

  const mergeRows = Array.isArray(parsed.mergeGroups) ? parsed.mergeGroups : [];
  for (let i = 0; i < mergeRows.length; i++) {
    const row = mergeRows[i];
    if (!row || typeof row !== "object") continue;
    const rawKeys = (row as { oldKeys?: unknown }).oldKeys;
    if (!Array.isArray(rawKeys) || rawKeys.length < 2) continue;
    const oldKeys = rawKeys
      .map((k) => (typeof k === "string" ? k.trim().toLowerCase() : ""))
      .filter((k) => /^blank_\d+$/.test(k))
      .filter((k) => !assigned.has(k));
    if (oldKeys.length < 2) continue;
    const n = blankNumber(oldKeys[0]) || i + 1;
    let newKey = sanitizeNepaliKey(
      typeof (row as { newKey?: unknown }).newKey === "string"
        ? String((row as { newKey: string }).newKey)
        : `विवरण_भर्नुहोस्_${n}`,
      n
    );
    if (usedNewKeys.has(newKey)) newKey = `${newKey}_${n}`;
    const labelNe =
      typeof (row as { labelNe?: unknown }).labelNe === "string" &&
      String((row as { labelNe: string }).labelNe).trim()
        ? String((row as { labelNe: string }).labelNe).trim()
        : newKey.replace(/_/g, " ");
    const labelEn =
      typeof (row as { labelEn?: unknown }).labelEn === "string" &&
      String((row as { labelEn: string }).labelEn).trim()
        ? String((row as { labelEn: string }).labelEn).trim()
        : labelNe;
    for (const key of oldKeys) assigned.add(key);
    usedNewKeys.add(newKey);
    mergeGroups.push({
      oldKeys,
      newKey,
      labelNe,
      labelEn,
      section:
        typeof (row as { section?: unknown }).section === "string"
          ? String((row as { section: string }).section).trim().slice(0, 80)
          : "",
    });
  }

  const singleRows = Array.isArray(parsed.singles) ? parsed.singles : [];
  for (let i = 0; i < singleRows.length; i++) {
    const row = singleRows[i];
    if (!row || typeof row !== "object") continue;
    const oldKey =
      typeof (row as { oldKey?: unknown }).oldKey === "string"
        ? String((row as { oldKey: string }).oldKey).trim().toLowerCase()
        : "";
    if (!/^blank_\d+$/.test(oldKey) || assigned.has(oldKey)) continue;
    const n = blankNumber(oldKey) || i + 1;
    let newKey = sanitizeNepaliKey(
      typeof (row as { newKey?: unknown }).newKey === "string"
        ? String((row as { newKey: string }).newKey)
        : `विवरण_भर्नुहोस्_${n}`,
      n
    );
    if (usedNewKeys.has(newKey)) newKey = `${newKey}_${n}`;
    assigned.add(oldKey);
    usedNewKeys.add(newKey);
    singles.push({
      oldKey,
      newKey,
      labelNe:
        typeof (row as { labelNe?: unknown }).labelNe === "string" &&
        String((row as { labelNe: string }).labelNe).trim()
          ? String((row as { labelNe: string }).labelNe).trim()
          : newKey.replace(/_/g, " "),
      labelEn:
        typeof (row as { labelEn?: unknown }).labelEn === "string" &&
        String((row as { labelEn: string }).labelEn).trim()
          ? String((row as { labelEn: string }).labelEn).trim()
          : newKey.replace(/_/g, " "),
      section:
        typeof (row as { section?: unknown }).section === "string"
          ? String((row as { section: string }).section).trim().slice(0, 80)
          : "",
    });
  }

  for (const blank of blanks) {
    if (assigned.has(blank.oldKey)) continue;
    const n = blankNumber(blank.oldKey);
    const newKey = `विवरण_भर्नुहोस्_${n}`;
    singles.push({
      oldKey: blank.oldKey,
      newKey,
      labelNe: `विवरण भर्नुहोस् ${n}`,
      labelEn: `Fill details ${n}`,
      section: "other",
    });
  }

  return { mergeGroups, singles };
}

function applyRenamePlan(buffer: Buffer, plan: RenamePlan): Buffer {
  const zip = new PizZip(buffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    let xml = zip.files[fileName].asText();

    for (const group of plan.mergeGroups) {
      if (group.oldKeys.length === 0) continue;
      const [first, ...rest] = group.oldKeys;
      xml = xml.replace(
        new RegExp(`\\{${first}\\}`, "gi"),
        `{${group.newKey}}`
      );
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

  const next = Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" })
  );
  const leftover = extractPlaceholdersFromDocx(next).filter((k) =>
    /^blank_\d+$/i.test(k)
  );
  if (leftover.length > 0) {
    throw new Error(`Orphan blanks remain: ${leftover.join(", ")}`);
  }
  return next;
}

function removeLeadingEmptyParagraphs(documentXml: string): string {
  return documentXml.replace(
    /(<w:body[^>]*>)([\s\S]*?)(<\/w:body>)/i,
    (_full, open: string, body: string, close: string) => {
      const sectMatch = body.match(
        /([\s\S]*?)(<w:sectPr\b[\s\S]*<\/w:sectPr>\s*)$/i
      );
      let main = sectMatch ? sectMatch[1] : body;
      const sect = sectMatch ? sectMatch[2] : "";
      let changed = true;
      while (changed) {
        changed = false;
        main = main.replace(
          /^\s*(<w:p\b[\s\S]*?<\/w:p>)/i,
          (match, paragraphXml: string) => {
            if (!paragraphPlainText(paragraphXml)) {
              changed = true;
              return "";
            }
            return match;
          }
        );
      }
      return `${open}${main}${sect}${close}`;
    }
  );
}

function applyGrammarFixes(xml: string): string {
  return xml
    .replace(/कानूनबमोजिम/g, "कानूनी बमोजिम")
    .replace(/कानुनबमोजिम/g, "कानूनी बमोजिम")
    .replace(/ठिक साँचो/g, "ठीक साँचो")
    .replace(/।।+/g, "।");
}

function fillBareEvidenceParagraphs(documentXml: string): string {
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/gi, (paragraphXml) => {
    const text = paragraphPlainText(paragraphXml);
    if (/^क\.\s*ख\.\s*ग\.\s*घ\.?$/.test(text)) {
      return rewriteParagraphText(
        paragraphXml,
        `(क) ${evidenceVar(1)} (ख) ${evidenceVar(2)} (ग) ${evidenceVar(3)} (घ) ${evidenceVar(4)}`
      );
    }
    if (/^क\.\s*ख\s*\.?$/.test(text)) {
      return rewriteParagraphText(
        paragraphXml,
        `(क) ${evidenceVar(1)} (ख) ${evidenceVar(2)}`
      );
    }
    if (/^संलग्न\s*कागजात\s*:?\s*क\.\s*ख\.\s*ग\.\s*घ\.?$/.test(text)) {
      return rewriteParagraphText(
        paragraphXml,
        `संलग्न कागजात: (क) ${evidenceVar(1)} (ख) ${evidenceVar(2)} (ग) ${evidenceVar(3)} (घ) ${evidenceVar(4)}`
      );
    }
    return paragraphXml;
  });
}

function normalizeEvidencePlaceholders(xml: string): string {
  xml = xml.replace(
    /(?<!\{)क\.\s*ख\.\s*ग\.\s*घ\.?(?![\w{])/g,
    `(क) ${evidenceVar(1)} (ख) ${evidenceVar(2)} (ग) ${evidenceVar(3)} (घ) ${evidenceVar(4)}`
  );
  xml = xml.replace(
    /\(क\)(?![^{]{0,5}\{)(\s*)\(ख\)(?![^{]{0,5}\{)/g,
    `(क) ${evidenceVar(1)}$1(ख) ${evidenceVar(2)}`
  );
  xml = xml.replace(
    /(\{संलग्न[_ ]कागज[_ ]प्रमाण[_ ]?[०-९0-9]+\})\s*\(/g,
    "$1 ("
  );
  xml = xml.replace(
    /\{संलग्न कागज प्रमाण ([०-९0-9]+)\}/g,
    (_m, digit: string) => {
      const n = "०१२३४५६७८९".includes(digit)
        ? "०१२३४५६७८९".indexOf(digit)
        : Number(digit);
      return evidenceVar(Number.isFinite(n) ? n : 1);
    }
  );
  return xml;
}

function normalizeCourtKeys(xml: string, courtType: "high" | "supreme"): string {
  if (courtType === "high") {
    // श्री उच्च अदालत{NAME} मा → श्री {उच्च_अदालतको_नाम} उच्च अदालतमा
    xml = xml.replace(
      /श्री\s*उच्च\s*अदालत\s*\{[^}]+\}\s*मा/g,
      "श्री {उच्च_अदालतको_नाम} उच्च अदालतमा"
    );
    xml = xml.replace(
      /श्री\s*उच्च\s*अदालत\s*\{[^}]+\}/g,
      "श्री {उच्च_अदालतको_नाम} उच्च अदालत"
    );
    xml = xml.replace(
      /श्री\s*\{उच्च_अदालत[^}]*\}\s*उच्च\s*अदालत(?:\s*उच्च\s*अदालत)*/g,
      "श्री {उच्च_अदालतको_नाम} उच्च अदालत"
    );
    xml = xml.replace(
      /श्री\s*\{उच्च_अदालतको_नाम\}\s*उच्च\s*अदालतमा/g,
      "श्री {उच्च_अदालतको_नाम} उच्च अदालतमा"
    );
  }

  xml = xml.replace(
    /माननीय\s*न्यायाधीश\s*श्री\s*\{[^}]+\}/g,
    "माननीय न्यायाधीश श्री {न्यायाधीशको_नाम}"
  );
  return xml;
}

function replaceBottomNivedakName(documentXml: string): string {
  const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/gi);
  if (!paragraphs || paragraphs.length === 0) return documentXml;

  const start = Math.max(0, paragraphs.length - 18);
  const skip = new Set<number>();
  const replacements = new Map<number, string>();

  for (let i = start; i < paragraphs.length; i++) {
    const text = paragraphPlainText(paragraphs[i]);
    if (text !== "निवेदक") continue;
    replacements.set(i, rewriteParagraphText(paragraphs[i], "{निवेदकको_नाम}"));
    const next = paragraphs[i + 1];
    if (
      next &&
      /^\{विवरण_भर्नुहोस्(_\d+)?\}$/.test(paragraphPlainText(next))
    ) {
      skip.add(i + 1);
    }
  }

  if (replacements.size === 0 && skip.size === 0) return documentXml;

  let index = 0;
  return documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/gi, (paragraphXml) => {
    const current = index;
    index += 1;
    if (skip.has(current)) return "";
    return replacements.get(current) ?? paragraphXml;
  });
}

function injectMissingCaseNumbers(xml: string): string {
  // Paragraph-level: official forms leave "मुद्दा र. नं. - मुद्दा नं. -" without underline blanks.
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/gi, (paragraphXml) => {
    const text = paragraphPlainText(paragraphXml);
    if (!text) return paragraphXml;
    if (/\{मुद्दा_नं\}/.test(text) || /\{मुद्दा_र_नं\}/.test(text)) {
      return paragraphXml;
    }
    let next = text.replace(
      /मुद्दा\s*\/?\s*रिट\s*र\.?\s*नं\.?\s*[-–]?\s*मुद्दा\s*\/?\s*रिट\s*नं\.?\s*[-–]?\s*/g,
      "मुद्दा/रिट र. नं. - {मुद्दा_र_नं} मुद्दा/रिट नं. - {मुद्दा_नं} "
    );
    next = next.replace(
      /मुद्दा\s*र\.?\s*नं\.?\s*[-–]?\s*मुद्दा\s*नं\.?\s*[-–]?\s*/g,
      "मुद्दा र. नं. - {मुद्दा_र_नं} मुद्दा नं. - {मुद्दा_नं} "
    );
    if (next === text) return paragraphXml;
    return rewriteParagraphText(paragraphXml, next);
  });
}

function cleanupOrphanEllipsis(xml: string): string {
  // Leftover unicode ellipsis / spaced dots next to placeholders
  return xml
    .replace(/\{([^}]+)\}\s*[…\u2026]+/g, "{$1} ")
    .replace(/[…\u2026]+\s*\{/g, " {")
    .replace(/([^\s{])\{/g, "$1 {")
    .replace(/\}([^\s}।,.])/g, "} $1");
}

function polishBuffer(buffer: Buffer, courtType: "high" | "supreme"): Buffer {
  const zip = new PizZip(buffer);
  for (const fileName of Object.keys(zip.files)) {
    if (!fileName.startsWith("word/") || !fileName.endsWith(".xml")) continue;
    if (zip.files[fileName].dir) continue;
    let xml = zip.files[fileName].asText();
    if (fileName === "word/document.xml") {
      xml = removeLeadingEmptyParagraphs(xml);
      xml = fillBareEvidenceParagraphs(xml);
      xml = replaceBottomNivedakName(xml);
    }
    xml = applyGrammarFixes(xml);
    xml = normalizeEvidencePlaceholders(xml);
    xml = normalizeCourtKeys(xml, courtType);
    xml = injectMissingCaseNumbers(xml);
    xml = cleanupOrphanEllipsis(xml);
    zip.file(fileName, xml);
  }
  return Buffer.from(
    zip.generate({ type: "nodebuffer", compression: "DEFLATE" })
  );
}

function formNumberFromKind(kind: string): number | null {
  const m = kind.match(/_official_form_(\d+)$/);
  return m ? Number(m[1]) : null;
}

function toDevanagariNumber(n: number): string {
  return String(n).replace(/\d/g, (d) => DEV_DIGITS[Number(d)] ?? d);
}

function outputFileName(entry: ManifestEntry): string {
  const n = formNumberFromKind(entry.documentKind);
  const title = entry.nameNe.replace(/[\\/:*?"<>|]/g, " ").trim();
  if (n != null) {
    return `फाराम न ${toDevanagariNumber(n)} ${title}.docx`;
  }
  return `${entry.originalFileName}`.replace(/\.docx$/i, "") + ".docx";
}

async function processOne(
  client: GoogleGenAI | null,
  entry: ManifestEntry,
  force: boolean,
  mode: "rules" | "gemini" | "auto"
): Promise<{ status: string; vars: number }> {
  const outDir = path.join(FINALIZED, entry.courtType);
  fs.mkdirSync(outDir, { recursive: true });
  const outName = outputFileName(entry);
  const outPath = path.join(outDir, outName);
  const metaPath = outPath.replace(/\.docx$/i, ".vars.json");

  if (!force && fs.existsSync(outPath) && fs.existsSync(metaPath)) {
    return { status: "skip-existing", vars: 0 };
  }

  const srcPath = path.isAbsolute(entry.processedPath)
    ? entry.processedPath
    : path.join(REPO_ROOT, entry.processedPath);
  if (!fs.existsSync(srcPath)) {
    return { status: `missing:${srcPath}`, vars: 0 };
  }

  let buffer: Buffer = fs.readFileSync(srcPath);
  const blanks = collectBlankContexts(buffer);
  if (blanks.length === 0) {
    buffer = polishBuffer(buffer, entry.courtType);
    fs.writeFileSync(outPath, buffer);
    const keys = extractPlaceholdersFromDocx(buffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        { documentKind: entry.documentKind, keys, variables: [] },
        null,
        2
      )
    );
    return { status: "no-blanks", vars: keys.length };
  }

  const outline = collectBlankOutline(buffer);
  let plan: RenamePlan;
  let usedMode = mode;
  if (mode === "rules") {
    plan = buildRuleBasedPlan(blanks, outline, entry.courtType);
  } else if (mode === "gemini") {
    if (!client) throw new Error("Gemini client required for --mode gemini");
    plan = await suggestMergesAndRenames(
      client,
      blanks,
      outline,
      entry.courtType
    );
  } else {
    try {
      if (!client) throw new Error("no client");
      plan = await suggestMergesAndRenames(
        client,
        blanks,
        outline,
        entry.courtType
      );
      usedMode = "gemini";
    } catch (err) {
      console.warn(
        `  gemini failed for ${entry.documentKind}, falling back to rules:`,
        err instanceof Error ? err.message.slice(0, 120) : err
      );
      plan = buildRuleBasedPlan(blanks, outline, entry.courtType);
      usedMode = "rules";
    }
  }

  buffer = applyRenamePlan(buffer, plan);
  buffer = polishBuffer(buffer, entry.courtType);
  fs.writeFileSync(outPath, buffer);

  const keys = extractPlaceholdersFromDocx(buffer);
  const variables = [
    ...plan.mergeGroups.map((g) => ({
      key: g.newKey,
      labelNe: g.labelNe,
      labelEn: g.labelEn,
      section: g.section || "",
    })),
    ...plan.singles.map((s) => ({
      key: s.newKey,
      labelNe: s.labelNe,
      labelEn: s.labelEn,
      section: s.section || "",
    })),
  ];
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      { documentKind: entry.documentKind, keys, variables, mode: usedMode },
      null,
      2
    )
  );
  return { status: `ok:${usedMode}`, vars: keys.length };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function main() {
  const { force, limit, court, mode } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`Manifest not found: ${MANIFEST}. Run process-sc-forms.py first.`);
  }
  let entries = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
  if (court === "high" || court === "supreme") {
    entries = entries.filter((e) => e.courtType === court);
  }
  // de-dupe by documentKind (keep first)
  const seen = new Set<string>();
  entries = entries.filter((e) => {
    if (seen.has(e.documentKind)) return false;
    seen.add(e.documentKind);
    return true;
  });
  entries.sort((a, b) => a.documentKind.localeCompare(b.documentKind));
  if (limit > 0) entries = entries.slice(0, limit);

  const client =
    mode === "rules"
      ? null
      : (() => {
          try {
            return loadGemini();
          } catch {
            if (mode === "gemini") throw new Error("GEMINI_API_KEY required");
            return null;
          }
        })();

  console.log(
    `Finalizing ${entries.length} templates (force=${force}, mode=${mode}, model=${mode === "rules" ? "n/a" : resolveModel()})`
  );

  const concurrency = mode === "rules" ? 8 : 2;
  const results = await mapPool(entries, concurrency, async (entry, index) => {
    try {
      const result = await processOne(client, entry, force, mode);
      console.log(
        `[${index + 1}/${entries.length}] ${entry.documentKind}: ${result.status} (${result.vars} vars)`
      );
      return { entry, ...result, error: "" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[${index + 1}/${entries.length}] ${entry.documentKind}: FAIL ${message}`
      );
      return { entry, status: "fail", vars: 0, error: message };
    }
  });

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status.startsWith("ok")).length,
    skipped: results.filter((r) => r.status === "skip-existing").length,
    failed: results.filter((r) => r.status === "fail").length,
    failures: results
      .filter((r) => r.status === "fail")
      .map((r) => ({ kind: r.entry.documentKind, error: r.error })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
